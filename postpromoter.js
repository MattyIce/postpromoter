var fs = require("fs");
const steem = require('steem');
var utils = require('./utils');

var account = null;
var last_trans = 0;
var outstanding_bids = [];
var config = null;
var first_load = true;
var isVoting = false;
var last_withdrawal = null;

steem.api.setOptions({ url: 'https://api.steemit.com' });

utils.log("*START*");

// Check if bot state has been saved to disk, in which case load it
if (fs.existsSync('state.json')) {
  var state = JSON.parse(fs.readFileSync("state.json"));

  if (state.last_trans)
    last_trans = state.last_trans;

  if (state.outstanding_bids)
    outstanding_bids = state.outstanding_bids;

  if(state.last_withdrawal)
    last_withdrawal = state.last_withdrawal;

  utils.log('Restored saved bot state: ' + JSON.stringify(state));
}

// Schedule to run every 10 seconds
setInterval(startProcess, 10000);

function startProcess() {
  // Load the settings from the config file each time so we can pick up any changes
  config = JSON.parse(fs.readFileSync("config.json"));

  // Load the bot account info
  steem.api.getAccounts([config.account], function (err, result) {
    account = result[0];

    // Check if there are any rewards to claim.
    claimRewards();

    // Check if it is time to withdraw funds.
    checkAutoWithdraw();
  });

  if (account && !isVoting) {
    getTransactions();

    // Load the current voting power of the account
    var vp = utils.getVotingPower(account);

    // We are at 100% voting power - time to vote!
    if (vp >= 10000 && outstanding_bids.length > 0) {

      // Don't process any bids while we are voting due to race condition (they will be processed when voting is done).
      isVoting = true;

      // Make a copy of the list of outstanding bids and vote on them
      startVoting(outstanding_bids.slice().reverse());

      // Reset the list of outstanding bids for the next round
      outstanding_bids = [];
    }

    // Save the state of the bot to disk.
    saveState();
  }
}

function startVoting(bids) {
  // Sum the amounts of all of the bids
  var total = bids.reduce(function(total, bid) { return total + bid.amount; }, 0);
  utils.log('=======================================================');
  utils.log('Bidding Round End! Starting to vote! Total bids: $' + total);
  utils.log('=======================================================');

  for(var i = 0; i < bids.length; i++) {
    // Calculate the vote weight to be used for each bid based on the amount bid as a percentage of the total bids
    bids[i].weight = Math.round(config.batch_vote_weight * 100 * (bids[i].amount / total));
  }

  vote(bids);
}

function vote(bids) {
  // Get the first bid in the list
  var bid = bids.pop();
  utils.log('Bid Weight: ' + bid.weight);
  steem.broadcast.vote(config.posting_key, account.name, bid.author, bid.permlink, bid.weight, function(err, result) {
    if (!err && result) {
      utils.log(utils.format(bid.weight / 100) + '% vote cast for: @' + bid.author + '/' + bid.permlink);

      // If promotion content is specified in the config then use it to comment on the upvoted post
      if (config.promotion_content && config.promotion_content != '') {
        // Generate the comment permlink via steemit standard convention
        var permlink = 're-' + bid.author.replace(/\./g, '') + '-' + bid.permlink + '-' + new Date().toISOString().replace(/-|:|\./g, '').toLowerCase();

        // Replace variables in the promotion content
        var content = config.promotion_content.replace(/\{weight\}/g, utils.format(bid.weight / 100)).replace(/\{botname\}/g, config.account).replace(/\{sender\}/g, bid.sender);

        // Broadcast the comment
        steem.broadcast.comment(config.posting_key, bid.author, bid.permlink, account.name, permlink, permlink, content, '{"app":"postpromoter/1.2.0"}', function (err, result) {
          if (err)
            utils.log(err, result);
        });
      }
    } else
      utils.log(err, result);
  });

  // If there are more bids, vote on the next one after 20 seconds
  if(bids.length > 0) {
    setTimeout(function() { vote(bids); }, 30000);
  } else {
    utils.log('=======================================================');
    utils.log('Voting Complete!');
    utils.log('=======================================================');
    isVoting = false;
  }
}

function getTransactions() {
  var num_trans = 50;

  // If this is the first time the bot is ever being run, start with just the most recent transaction
  if (first_load && last_trans == 0) {
    utils.log('First run - starting with last transaction on account.');
    num_trans = 1;
  }

  // If this is the first time the bot is run after a restart get a larger list of transactions to make sure none are missed
  if (first_load && last_trans > 0) {
    utils.log('First run - loading all transactions since bot was stopped.');
    num_trans = 1000;
  }

  steem.api.getAccountHistory(account.name, -1, num_trans, function (err, result) {
    first_load = false;

    result.forEach(function(trans) {
      var op = trans[1].op;

        // Check that this is a new transaction that we haven't processed already
        if(trans[0] > last_trans) {

          // We only care about SBD transfers to the bot
          if (op[0] == 'transfer' && op[1].to == account.name) {
            var amount = parseFloat(op[1].amount);
            var currency = utils.getCurrency(op[1].amount);
            utils.log("Incoming Bid! From: " + op[1].from + ", Amount: " + op[1].amount + ", memo: " + op[1].memo);

            // Check for min and max bid values in configuration settings
            var min_bid = config.min_bid ? parseFloat(config.min_bid) : 0;
            var max_bid = config.max_bid ? parseFloat(config.max_bid) : 9999;

            if(config.disabled_mode) {
              // Bot is disabled, refund all Bids
              refund(op[1].from, amount, currency, 'Bot is disabled!');
            } else if(amount < min_bid) {
              // Bid amount is too low
              refund(op[1].from, amount, currency, 'Min bid amount is ' + config.min_bid);
            } else if (amount > max_bid) {
              // Bid amount is too high
              refund(op[1].from, amount, currency, 'Max bid amount is ' + config.max_bid);
            } else if(currency != 'SBD') {
              // Sent STEEM instead of SBD
              refund(op[1].from, amount, currency, 'Only SBD bids accepted!');
            } else {
              // Bid amount is just right!
              checkPost(op[1].memo, amount, op[1].from);
            }
          }

          // Save the ID of the last transaction that was processed.
          last_trans = trans[0];
        }
    });
  });
}

function checkPost(memo, amount, sender) {
    // Parse the author and permlink from the memo URL
    var permLink = memo.substr(memo.lastIndexOf('/') + 1);
    var author = memo.substring(memo.lastIndexOf('@') + 1, memo.lastIndexOf('/'));

    // Make sure the author isn't on the blacklist!
    if(config.blacklist && config.blacklist.indexOf(author) >= 0)
    {
      utils.log('Invalid Bid - @' + author + ' is on the blacklist!');
      return;
    }

    steem.api.getContent(author, permLink, function (err, result) {
        if (!err && result && result.id > 0) {

            // If comments are not allowed then we need to first check if the post is a comment
            if(!config.allow_comments && (result.parent_author != null && result.parent_author != '')) {
              refund(sender, amount, 'SBD', 'Bids not allowed on comments.');
              return;
            }

            var created = new Date(result.created + 'Z');

            // Get the list of votes on this post to make sure the bot didn't already vote on it (you'd be surprised how often people double-submit!)
            var votes = result.active_votes.filter(function(vote) { return vote.voter == account.name; });

            if (votes.length > 0 || (new Date() - created) >= (config.max_post_age * 60 * 60 * 1000)) {
                // This post is already voted on by this bot or the post is too old to be voted on
                refund(sender, amount, 'SBD', ((votes.length > 0) ? 'Already Voted' : 'Post older than max age'));
                return;
            }
        } else {
            // Invalid memo
            refund(sender, amount, 'SBD', 'Invalid Memo');
            return;
        }

        // Check if there is already a bid for this post in the current round
        var existing_bid = outstanding_bids.find(bid => bid.url == result.url);

        if(existing_bid) {
          // There is already a bid for this post in the current round
          utils.log('Existing Bid Found - New Amount: ' + amount + ', Total Amount: ' + (existing_bid.amount + amount));
          existing_bid.amount += amount;
        } else {
          // All good - push to the array of valid bids for this round
          utils.log('Valid Bid - Amount: ' + amount + ', Title: ' + result.title);
          outstanding_bids.push({ amount: amount, sender: sender, author: result.author, permlink: result.permlink, url: result.url });
        }
    });
}

function saveState() {
  // Save the state of the bot to disk
  fs.writeFile('state.json', JSON.stringify({ outstanding_bids: outstanding_bids, last_trans: last_trans, last_withdrawal: last_withdrawal }), function (err) {
    if (err)
      utils.log(err);
  });
}

function refund(sender, amount, currency, reason) {
  // Make sure refunds are enabled and the sender isn't on the no-refund list (for exchanges and things like that).
  if(!config.refunds_enabled || (config.no_refund && config.no_refund.indexOf(sender) >= 0)) {
    utils.log("Invalid bid - " + reason + ' NO REFUND');
    return;
  }

  // Issue the refund.
  steem.broadcast.transfer(config.active_key, config.account, sender, utils.format(amount, 3) + ' ' + currency, 'Refund for invalid bid - ' + reason, function(err, response) {
    if(err)
      utils.log(err, response);
    else {
      utils.log('Refund of ' + amount + ' ' + currency + ' sent to @' + sender + ' for reason: ' + reason);
    }
  });
}

function claimRewards() {
  if (!config.auto_claim_rewards)
    return;

  // Make api call only if you have actual reward
  if (parseFloat(account.reward_steem_balance) > 0 || parseFloat(account.reward_sbd_balance) > 0 || parseFloat(account.reward_vesting_balance) > 0) {
    steem.broadcast.claimRewardBalance(config.posting_key, config.account, account.reward_steem_balance, account.reward_sbd_balance, account.reward_vesting_balance, function (err, result) {
      if (err) {
        utils.log(err);
      }

      if (result) {
        utils.log('$$$ Rewards Claim SBD:' + account.reward_sbd_balance + ', STEEM:' + account.reward_steem_balance + ', Vesting:' + account.reward_vesting_balance);
      }
    });
  }
}

function checkAutoWithdraw() {
  // Check if auto-withdraw is active
  if (!config.auto_withdrawal.active)
    return;

  // If it's past the withdrawal time and we haven't made a withdrawal today and there is a positive SBD balance, then process the withdrawal
  if (new Date(new Date().toDateString()) > new Date(last_withdrawal) && new Date().getHours() >= config.auto_withdrawal.execute_time && parseFloat(account.sbd_balance) > 0) {
    // Save the date of the last withdrawal
    last_withdrawal = new Date().toDateString();

    // Load account details of the account we are sending the withdrawal to (this is needed for encrypted memos)
    steem.api.getAccounts([config.auto_withdrawal.to_account], function(err, result) {
      var to_account = result[0];
      var memo = config.auto_withdrawal.memo.replace(/\{balance\}/g, account.sbd_balance);

      // Encrypt memo
      if(memo.startsWith('#'))
        memo = steem.memo.encode(config.memo_key, to_account.memo_key, memo);

      // Withdraw all available SBD to the specified account
      steem.broadcast.transfer(config.active_key, config.account, config.auto_withdrawal.to_account, account.sbd_balance, memo, function (err, response) {
        if (err)
          utils.log(err, response);
        else {
          utils.log('$$$ Auto withdrawal: ' + account.sbd_balance + ' sent to @' + config.auto_withdrawal.to_account);
        }
      });
    });
  }
}
