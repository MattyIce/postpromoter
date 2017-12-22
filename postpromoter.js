var fs = require("fs");
const steem = require('steem');
var utils = require('./utils');

var account = null;
var last_trans = 0;
var outstanding_bids = [];
var last_round = [];
var config = null;
var first_load = true;
var isVoting = false;
var last_withdrawal = null;
var steem_price = 1;  // This will get overridden with actual prices if a price_feed_url is specified in settings
var sbd_price = 1;    // This will get overridden with actual prices if a price_feed_url is specified in settings

steem.api.setOptions({ url: 'https://api.steemit.com' });

utils.log("*START*");

// Load the settings from the config file
config = JSON.parse(fs.readFileSync("config.json"));

// If the API is enabled, start the web server
if(config.api && config.api.enabled) {
  var express = require('express');
  var app = express();

  app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
  });

  app.get('/api/bids', (req, res) => res.json({ current_round: outstanding_bids, last_round: last_round }));
  app.listen(config.api.port, () => utils.log('API running on port ' + config.api.port))
}

// Check if bot state has been saved to disk, in which case load it
if (fs.existsSync('state.json')) {
  var state = JSON.parse(fs.readFileSync("state.json"));

  if (state.last_trans)
    last_trans = state.last_trans;

  if (state.outstanding_bids)
    outstanding_bids = state.outstanding_bids;

  if (state.last_round)
    last_round = state.last_round;

  if(state.last_withdrawal)
    last_withdrawal = state.last_withdrawal;

  utils.log('Restored saved bot state: ' + JSON.stringify(state));
}

// Schedule to run every 10 seconds
setInterval(startProcess, 10000);

// Load updated STEEM and SBD prices every minute
setInterval(loadPrices, 60000);

function startProcess() {
  // Load the settings from the config file each time so we can pick up any changes
  config = JSON.parse(fs.readFileSync("config.json"));

  // Load the bot account info
  steem.api.getAccounts([config.account], function (err, result) {
    account = result[0];

    // Check if there are any rewards to claim.
    claimRewards();

    // Check if it is time to withdraw funds.
    if (config.auto_withdrawal.frequency == 'daily')
      checkAutoWithdraw();
  });

  if (account && !isVoting) {
    // Load the current voting power of the account
    var vp = utils.getVotingPower(account);

    if(config.detailed_logging)
      utils.log('Voting Power: ' + utils.format(vp / 100) + '% | Time until next round: ' + utils.toTimer(utils.timeTilFullPower(vp)));

    // We are at 100% voting power - time to vote!
    if (vp >= 10000 && outstanding_bids.length > 0) {

      // Don't process any bids while we are voting due to race condition (they will be processed when voting is done).
      isVoting = first_load = true;

      // Make a copy of the list of outstanding bids and vote on them
      startVoting(outstanding_bids.slice().reverse());

      // Save the last round of bids for use in API call
      last_round = outstanding_bids.slice();

      // Reset the list of outstanding bids for the next round
      outstanding_bids = [];

      // Send out earnings if frequency is set to every round
      if (config.auto_withdrawal.frequency == 'round_end')
        processWithdrawals();
    } else {
      getTransactions();
    }

    // Save the state of the bot to disk.
    saveState();
  }
}

function startVoting(bids) {
  // Sum the amounts of all of the bids
  var total = bids.reduce(function(total, bid) {
    return total + getUsdValue(bid);
  }, 0);

  utils.log('=======================================================');
  utils.log('Bidding Round End! Starting to vote! Total bids: $' + total);
  utils.log('=======================================================');

  for(var i = 0; i < bids.length; i++) {
    // Calculate the vote weight to be used for each bid based on the amount bid as a percentage of the total bids
    bids[i].weight = Math.round(config.batch_vote_weight * 100 * (getUsdValue(bids[i]) / total));
  }

  vote(bids);
}

function vote(bids) {
  // Get the first bid in the list
  sendVote(bids.pop(), 0);

  // If there are more bids, vote on the next one after 20 seconds
  if(bids.length > 0) {
    setTimeout(function() { vote(bids); }, 30000);
  } else {
    setTimeout(function() {
      utils.log('=======================================================');
      utils.log('Voting Complete!');
      utils.log('=======================================================');
      isVoting = false;
    }, 30000);
  }
}

function sendVote(bid, retries) {
  utils.log('Bid Weight: ' + bid.weight);
  steem.broadcast.vote(config.posting_key, account.name, bid.author, bid.permlink, bid.weight, function (err, result) {
    if (!err && result) {
      utils.log(utils.format(bid.weight / 100) + '% vote cast for: @' + bid.author + '/' + bid.permlink);

      // If promotion content is specified in the config then use it to comment on the upvoted post
      if (config.promotion_content && config.promotion_content != '') {
        // Generate the comment permlink via steemit standard convention
        var permlink = 're-' + bid.author.replace(/\./g, '') + '-' + bid.permlink + '-' + new Date().toISOString().replace(/-|:|\./g, '').toLowerCase();

        // Replace variables in the promotion content
        var content = config.promotion_content.replace(/\{weight\}/g, utils.format(bid.weight / 100)).replace(/\{botname\}/g, config.account).replace(/\{sender\}/g, bid.sender);

        // Broadcast the comment
        steem.broadcast.comment(config.posting_key, bid.author, bid.permlink, account.name, permlink, permlink, content, '{"app":"postpromoter/1.6.0"}', function (err, result) {
          if (err)
            utils.log(err, result);
        });
      }
    } else {
      utils.log(err, result);

      // Try again one time on error
      if(retries < 1)
        sendVote(bid, retries + 1);
      else {
        utils.log('============= Vote transaction failed two times for: ' + bid.permlink + ' ===============');
      }
    }
  });
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
              refund(op[1].from, amount, currency, 'bot_disabled');
            } else if(config.currencies_accepted && config.currencies_accepted.indexOf(currency) < 0) {
              // Sent an unsupported currency
              refund(op[1].from, amount, currency, 'invalid_currency');
            } else if(amount < min_bid) {
              // Bid amount is too low
              refund(op[1].from, amount, currency, 'below_min_bid');
            } else if (amount > max_bid) {
              // Bid amount is too high
              refund(op[1].from, amount, currency, 'above_max_bid');
            } else {
              // Bid amount is just right!
              checkPost(op[1].memo, amount, currency, op[1].from);
            }
          }

          // Save the ID of the last transaction that was processed.
          last_trans = trans[0];
        }
    });
  });
}

function checkPost(memo, amount, currency, sender) {
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
              refund(sender, amount, currency, 'no_comments');
              return;
            }

            var created = new Date(result.created + 'Z');

            // Get the list of votes on this post to make sure the bot didn't already vote on it (you'd be surprised how often people double-submit!)
            var votes = result.active_votes.filter(function(vote) { return vote.voter == account.name; });

            if (votes.length > 0 || (new Date() - created) >= (config.max_post_age * 60 * 60 * 1000)) {
                // This post is already voted on by this bot or the post is too old to be voted on
                refund(sender, amount, currency, ((votes.length > 0) ? 'already_voted' : 'max_age'));
                return;
            }
        } else {
            // Invalid memo
            refund(sender, amount, currency, 'invalid_post_url');
            return;
        }

        // Check if there is already a bid for this post in the current round
        var existing_bid = outstanding_bids.find(bid => bid.url == result.url);

        if(existing_bid) {
          // There is already a bid for this post in the current round
          utils.log('Existing Bid Found - New Amount: ' + amount + ', Total Amount: ' + (existing_bid.amount + amount));

          if(existing_bid.currency == currency) {
            existing_bid.amount += amount;
          } else if(existing_bid.currency == 'STEEM') {
            existing_bid.amount += amount * sbd_price / steem_price;
          } else if(existing_bid.currency == 'SBD') {
            existing_bid.amount += amount * steem_price / sbd_price;
          }
        } else {
          // All good - push to the array of valid bids for this round
          utils.log('Valid Bid - Amount: ' + amount + ', Title: ' + result.title);
          outstanding_bids.push({ amount: amount, currency: currency, sender: sender, author: result.author, permlink: result.permlink, url: result.url });
        }
    });
}

function saveState() {
  var state = {
    outstanding_bids: outstanding_bids,
    last_round: last_round,
    last_trans: last_trans,
    last_withdrawal: last_withdrawal
  };

  // Save the state of the bot to disk
  fs.writeFile('state.json', JSON.stringify(state), function (err) {
    if (err)
      utils.log(err);
  });
}

function refund(sender, amount, currency, reason) {
  // Make sure refunds are enabled and the sender isn't on the no-refund list (for exchanges and things like that).
  if (!config.refunds_enabled || (config.no_refund && config.no_refund.indexOf(sender) >= 0)) {
    utils.log("Invalid bid - " + reason + ' NO REFUND');
    return;
  }

  // Replace variables in the memo text
  var memo = config.transfer_memos[reason];
  memo = memo.replace(/{amount}/g, utils.format(amount, 3) + ' ' + currency);
  memo = memo.replace(/{currency}/g, currency);
  memo = memo.replace(/{min_bid}/g, config.min_bid);
  memo = memo.replace(/{max_bid}/g, config.max_bid);

  var days = Math.floor(config.max_post_age / 24);
  var hours = (config.max_post_age % 24);
  memo = memo.replace(/{max_age}/g, days + ' Day(s)' + ((hours > 0) ? ' ' + hours + ' Hour(s)' : ''));

  // Issue the refund.
  steem.broadcast.transfer(config.active_key, config.account, sender, utils.format(amount, 3) + ' ' + currency, memo, function (err, response) {
    if (err)
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

        var rewards_message = "$$$ ==> Rewards Claim";
        if (parseFloat(account.reward_sbd_balance) > 0) { rewards_message = rewards_message + ' SBD: ' + parseFloat(account.reward_sbd_balance); }
        if (parseFloat(account.reward_steem_balance) > 0) { rewards_message = rewards_message + ' STEEM: ' + parseFloat(account.reward_steem_balance); }
        if (parseFloat(account.reward_vesting_balance) > 0) { rewards_message = rewards_message + ' VESTS: ' + parseFloat(account.reward_vesting_balance); }

        utils.log(rewards_message);

        // If there are liquid post rewards, withdraw them to the specified account
        if(parseFloat(account.reward_sbd_balance) > 0 && config.post_rewards_withdrawal_account && config.post_rewards_withdrawal_account != '') {

          // Send liquid post rewards to the specified account
          steem.broadcast.transfer(config.active_key, config.account, config.post_rewards_withdrawal_account, account.reward_sbd_balance, 'Liquid Post Rewards Withdrawal', function (err, response) {
            if (err)
              utils.log(err, response);
            else {
              utils.log('$$$ Auto withdrawal - liquid post rewards: ' + account.reward_sbd_balance + ' sent to @' + config.post_rewards_withdrawal_account);
            }
          });
        }
      }
    });
  }
}

function checkAutoWithdraw() {
  // Check if auto-withdraw is active
  if (!config.auto_withdrawal.active)
    return;

  // If it's past the withdrawal time and we haven't made a withdrawal today, then process the withdrawal
  if (new Date(new Date().toDateString()) > new Date(last_withdrawal) && new Date().getHours() >= config.auto_withdrawal.execute_time) {
    processWithdrawals();
  }
}

function processWithdrawals() {
  var has_sbd = config.currencies_accepted.indexOf('SBD') >= 0 && parseFloat(account.sbd_balance) > 0;
  var has_steem = config.currencies_accepted.indexOf('STEEM') >= 0 && parseFloat(account.balance) > 0;

  if (has_sbd || has_steem) {

    // Save the date of the last withdrawal
    last_withdrawal = new Date().toDateString();

    var total_stake = config.auto_withdrawal.accounts.reduce(function (total, info) { return total + info.stake; }, 0);

    config.auto_withdrawal.accounts.forEach(function (withdrawal_account) {
      // Load account details of the account we are sending the withdrawal to (this is needed for encrypted memos)
      steem.api.getAccounts([withdrawal_account.name], function (err, result) {
        var to_account = result[0];

        if (has_sbd) {
          // Calculate this accounts percentage of the total earnings
          var amount = parseFloat(account.sbd_balance) * (withdrawal_account.stake / total_stake) - 0.001;

          // Withdraw all available SBD to the specified account
          sendWithdrawal(to_account, amount, 'SBD', 0)
        }

        if (has_steem) {
          // Calculate this accounts percentage of the total earnings
          var amount = parseFloat(account.balance) * (withdrawal_account.stake / total_stake);

          // Withdraw all available STEEM to the specified account
          sendWithdrawal(to_account, amount, 'STEEM', 0)
        }
      });
    });
  }
}

function sendWithdrawal(to_account, amount, currency, retries) {
  var formatted_amount = utils.format(amount, 3).replace(/,/g, '') + ' ' + currency;
  var memo = config.auto_withdrawal.memo.replace(/\{balance\}/g, formatted_amount);

  // Encrypt memo
  if (memo.startsWith('#') && config.memo_key && config.memo_key != '')
    memo = steem.memo.encode(config.memo_key, to_account.memo_key, memo);

  // Send the withdrawal amount to the specified account
  steem.broadcast.transfer(config.active_key, config.account, to_account.name, formatted_amount, memo, function (err, response) {
    if (err) {
      utils.log(err, response);

      // Try again once if there is an error
      if(retries < 1)
        sendWithdrawal(to_account, amount, currency, retries + 1);
      else {
        utils.log('============= Withdrawal failed two times to: ' + to_account + ' for: ' + formatted_amount + ' ===============');
      }
    } else {
      utils.log('$$$ Auto withdrawal: ' + formatted_amount + ' sent to @' + to_account.name);
    }
  });
}

function loadPrices() {
  if(!config.price_feed_url || config.price_feed_url == '')
    return;

  // Require the "request" library for making HTTP requests
  var request = require("request");

  // Load the price feed data
  request.get(config.price_feed_url, function (e, r, data) {
    var prices = JSON.parse(data);
    steem_price = prices.steem_price;
    sbd_price = prices.sbd_price;

    if(config.detailed_logging)
      utils.log('Prices Loaded - STEEM: ' + utils.format(steem_price) + ', SBD: ' + utils.format(sbd_price));
  });
}

function getUsdValue(bid) { return bid.amount * ((bid.currency == 'SBD') ? sbd_price : steem_price); }
