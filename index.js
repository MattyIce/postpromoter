var fs = require("fs");
const steem = require('steem');
var utils = require('./utils');

var account = null;
var last_trans = 0;
var outstanding_bids = [];
var config = null;
var posting_key = process.argv[2];

steem.api.setOptions({ url: 'https://api.steemit.com' });

console.log("\n *START* \n");

startProcess();

function startProcess() {
  //console.log("Begin Processing...");

  // Load the settings from the config file each time so we can pick up any changes
  config = JSON.parse(fs.readFileSync("config.json"));

  steem.api.getAccounts([config.account], function(err, result) {
    account = result[0];
  });

  if(account) {
    getTransactions();

    // Load and log the current voting power of the account
    var vp = utils.getVotingPower(account);
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write("Voting Power: " + vp);


    // We are at 100% voting power - time to vote!
    if(vp >= 10000 && outstanding_bids.length > 0) {
      // Make a copy of the list of outstanding bids and vote on them
      startVoting(outstanding_bids.slice());

      // Reset the list of outstanding bids for the next round
      outstanding_bids = [];
    }
  }

  //console.log("End Processing...");
  setTimeout(startProcess, 5000);
}

function startVoting(bids) {
  // Sum the amounts of all of the bids
  var total = bids.reduce(function(total, bid) { return total + bid.amount; }, 0);
  console.log('Round Total: ' + total);

  for(var i = 0; i < bids.length; i++) {
    // Calculate the vote weight to be used for each bid based on the amount bid as a percentage of the total bids
    bids[i].weight = Math.round(10000 * (bids[i].amount / total));
  }

  vote(bids);
}

function vote(bids) {
  // Get the first bid in the list
  var bid = bids.pop();
  console.log('Bid Weight: ' + bid.weight);
  steem.broadcast.vote(posting_key, account.name, bid.post.author, bid.post.permlink, bid.weight, function(err, result) {
  //  console.log(err, result);

    if(!err && result) {

      // If promotion content is specified in the config then use it to comment on the upvoted post
      if(config.promotion_content && config.promotion_content != '') {
        // Generate the comment permlink via steemit standard convention
        var permlink = 're-' + bid.post.author + '-' + bid.post.permlink + '-' + new Date().toISOString().replace(/-|:|\./g, '').toLowerCase();

        // Replace variables in the promotion content
        var content = config.promotion_content.replace(/\{weight\}/g, utils.format(bid.weight / 100)).replace(/\{sender\}/g, bid.sender);

        // Broadcast the comment
        steem.broadcast.comment(posting_key, bid.post.author, bid.post.permlink, account.name, permlink, permlink, content, '', function(err, result) {
          console.log(err, result);
        });
      }
    }
  });

  // If there are more bids, vote on the next one after 20 seconds
  if(bids.length > 0)
    setTimeout(function() { vote(bids); }, 20000);
}

function getTransactions() {
  steem.api.getAccountHistory(account.name, -1, 50, function (err, result) {
    result.forEach(function(trans) {
        var op = trans[1].op;

        // Check that this is a new transaction that we haven't processed already
        if(trans[0] > last_trans) {

          // We only care about SBD transfers to the bot
          if (op[0] == 'transfer' && op[1].to == account.name && op[1].amount.indexOf('SBD') > 0) {
            var amount = parseFloat(op[1].amount.replace(" SBD", ""));
            console.log("*** Incoming Transaction! Amount: " + amount + " SBD, memo: " + op[1].memo);

            // Check for min and max bid values in configuration settings
            var min_bid = config.min_bid ? parseFloat(config.min_bid) : 0;
            var max_bid = config.max_bid ? parseFloat(config.max_bid) : 9999;

            if(amount < min_bid) {
              // Bid amount is too low
              console.log('Invalid Bid - ' + amount + ' is less than min bid amount of ' + parseFloat(config.min_bid));
            } else if (amount > max_bid) {
              // Bid amount is too high
              console.log('Invalid Bid - ' + amount + ' is greater than max bid amount of ' + parseFloat(config.max_bid));
            } else {
              // Bid amount is just right!
              checkPost(op[1].memo, amount, op[1].from);
            }
          }

          // Save the ID of the last transaction that was processed.
          last_trans = trans[0];
        }

        //console.log(trans);
    });
  });
}

function checkPost(memo, amount, sender) {
    var permLink = memo.substr(memo.lastIndexOf('/') + 1);
    var author = memo.substring(memo.lastIndexOf('@') + 1, memo.lastIndexOf('/'));
    console.log('Checking Post: ' + author + '/' + permLink);

    steem.api.getContent(author, permLink, function (err, result) {
        if (!err && result && result.id > 0) {
            console.log('Loaded Post: ' + result.title);

            // If comments are not allowed then we need to first check if the post is a comment
            if(!config.allow_comments && (result.parent_author != null && result.parent_author != '')) {
              console.log('Invalid Post - Comments not allowed!')
              return;
            }

            var created = new Date(result.created + 'Z');
            var votes = result.active_votes.filter(function(vote) { return vote.voter == account.name; });
            var already_voted = votes.length > 0 && (new Date() - new Date(votes[0].time + 'Z') > 20 * 60 * 1000);

            if(already_voted || (new Date() - created) >= (config.max_post_age * 60 * 60 * 1000)) {
                // This post is already voted on by this bot or the post is too old to be voted on
                console.log('Invalid Post - ' + (already_voted ? 'Already Voted' : 'Post older than max age'));
                return;
            }
        } else {
            // Invalid memo
            console.log('Invalid Post - Invalid Memo');
            return;
        }

        // All good - push to the array of valid bids for this round
        console.log('Valid Bid - Amount: ' + amount + ', Title: ' + result.title);
        outstanding_bids.push({ amount: amount, sender: sender, post: result });
    });
}
