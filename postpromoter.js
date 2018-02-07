var fs = require("fs");
const steem = require('steem');
var utils = require('./utils');

var account = null;
var last_trans = 0;
var outstanding_bids = [];
var delegators = [];
var last_round = [];
var config = null;
var first_load = true;
var isVoting = false;
var last_withdrawal = null;
var use_delegators = false;
var steem_price = 1;  // This will get overridden with actual prices if a price_feed_url is specified in settings
var sbd_price = 1;    // This will get overridden with actual prices if a price_feed_url is specified in settings
var version = '1.8.4';

// Load the settings from the config file
loadConfig();

// Connect to the specified RPC node
var rpc_node = config.rpc_nodes ? config.rpc_nodes[0] : (config.rpc_node ? config.rpc_node : 'https://api.steemit.com');
steem.api.setOptions({ transport: 'http', uri: rpc_node, url: rpc_node });

utils.log("* START - Version: " + version + " *");
utils.log("Connected to: " + rpc_node);

// Load Steem global variables
utils.updateSteemVariables();

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

// Check whether or not auto-withdrawals are set to be paid to delegators.
use_delegators = config.auto_withdrawal && config.auto_withdrawal.active && config.auto_withdrawal.accounts.find(a => a.name == '$delegators');

// If so then we need to load the list of delegators to the account
if(use_delegators) {
  if(fs.existsSync('delegators.json')) {
    delegators = JSON.parse(fs.readFileSync("delegators.json"));

    var vests = delegators.reduce(function (total, v) { return total + parseFloat(v.vesting_shares); }, 0);
    utils.log('Delegators Loaded (from disk) - ' + delegators.length + ' delegators and ' + vests + ' VESTS in total!');
  }
  else
  {
    var del = require('./delegators');
    utils.log('Started loading delegators from account history...');
    del.loadDelegations(config.account, function(d) {
      delegators = d;
      var vests = delegators.reduce(function (total, v) { return total + parseFloat(v.vesting_shares); }, 0);
      utils.log('Delegators Loaded (from account history) - ' + delegators.length + ' delegators and ' + vests + ' VESTS in total!');

      // Save the list of delegators to disk
      saveDelegators();
    });
  }
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

  utils.log('Restored saved bot state: ' + JSON.stringify({ last_trans: last_trans, bids: outstanding_bids.length, last_withdrawal: last_withdrawal }));
}

// Schedule to run every 10 seconds
setInterval(startProcess, 10000);

// Load updated STEEM and SBD prices every 30 minutes
loadPrices();
setInterval(loadPrices, 30 * 60 * 1000);

function startProcess() {
  // Load the settings from the config file each time so we can pick up any changes
  loadConfig();

  // Load the bot account info
  steem.api.getAccounts([config.account], function (err, result) {
    if (result && !err) {
      account = result[0];

      // Check if there are any rewards to claim.
      claimRewards();

      // Check if it is time to withdraw funds.
      if (config.auto_withdrawal.frequency == 'daily')
        checkAutoWithdraw();
    } else
      logError('Error loading bot account: ' + err);
  });

  if (account && !isVoting) {
    // Load the current voting power of the account
    var vp = utils.getVotingPower(account);

    if(config.detailed_logging) {
      var bids_steem = utils.format(outstanding_bids.reduce(function(t, b) { return t + ((b.currency == 'STEEM') ? b.amount : 0); }, 0), 3);
      var bids_sbd = utils.format(outstanding_bids.reduce(function(t, b) { return t + ((b.currency == 'SBD') ? b.amount : 0); }, 0), 3);
      utils.log('Voting Power: ' + utils.format(vp / 100) + '% | Time until next round: ' + utils.toTimer(utils.timeTilFullPower(vp)) + ' | Bids: ' + outstanding_bids.length + ' | ' + bids_sbd + ' SBD | ' + bids_steem + ' STEEM');
    }

    // We are at 100% voting power - time to vote!
    if (vp >= 10000 && outstanding_bids.length > 0) {

      // Don't process any bids while we are voting due to race condition (they will be processed when voting is done).
      isVoting = true;

      // Add a little delay to get last-minute bids in
      setTimeout(function () {
        getTransactions(function () {
          first_load = true;

          // Make a copy of the list of outstanding bids and vote on them
          startVoting(outstanding_bids.slice().reverse());

          // Save the last round of bids for use in API call
          last_round = outstanding_bids.slice();

          // Reset the list of outstanding bids for the next round
          outstanding_bids = [];

          // Send out earnings if frequency is set to every round
          if (config.auto_withdrawal.frequency == 'round_end')
            processWithdrawals();
        });
      }, 30 * 1000);
    } else
      getTransactions();

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
  utils.log('Bidding Round End! Starting to vote! Total bids: ' + bids.length + ' - $' + total);
  utils.log('=======================================================');

  for(var i = 0; i < bids.length; i++) {
    // Calculate the vote weight to be used for each bid based on the amount bid as a percentage of the total bids
    bids[i].weight = Math.round(config.batch_vote_weight * 100 * (getUsdValue(bids[i]) / total));
  }

  comment(bids.slice());
  vote(bids);
}

function vote(bids) {
  // Get the first bid in the list
  sendVote(bids.pop(), 0, function () {
    // If there are more bids, vote on the next one after 10 seconds
    if (bids.length > 0) {
      setTimeout(function () { vote(bids); }, 5000);
    } else {
      setTimeout(function () {
        utils.log('=======================================================');
        utils.log('Voting Complete!');
        utils.log('=======================================================');
        isVoting = false;
        first_load = true;
      }, 5000);
    }
  });
}

function comment(bids) {
  sendComment(bids.pop());

  if(bids.length > 0)
    setTimeout(function () { comment(bids); }, 30000);
}

function sendVote(bid, retries, callback) {
  utils.log('Bid Weight: ' + bid.weight);
  steem.broadcast.vote(config.posting_key, account.name, bid.author, bid.permlink, bid.weight, function (err, result) {
    if (!err && result) {
      utils.log(utils.format(bid.weight / 100) + '% vote cast for: @' + bid.author + '/' + bid.permlink);

      if (callback)
        callback();
    } else {
      logError('Error sending vote for: @' + bid.author + '/' + bid.permlink + ', Error: ' + err);

      // Try again on error
      if(retries < 2)
        setTimeout(function() { sendVote(bid, retries + 1, callback); }, 3000);
      else {
        utils.log('============= Vote transaction failed three times for: ' + bid.permlink + ' ===============');

        if (callback)
          callback();
      }
    }
  });
}

function sendComment(bid) {
  var content = null;

  if(config.comment_location && config.comment_location != '') {
    content = fs.readFileSync(config.comment_location, "utf8");
  } else if (config.promotion_content && config.promotion_content != '') {
    content = config.promotion_content;
  }

  // If promotion content is specified in the config then use it to comment on the upvoted post
  if (content && content != '') {

    // Generate the comment permlink via steemit standard convention
    var permlink = 're-' + bid.author.replace(/\./g, '') + '-' + bid.permlink + '-' + new Date().toISOString().replace(/-|:|\./g, '').toLowerCase();

    // Replace variables in the promotion content
    content = content.replace(/\{weight\}/g, utils.format(bid.weight / 100)).replace(/\{botname\}/g, config.account).replace(/\{sender\}/g, bid.sender);

    // Broadcast the comment
    steem.broadcast.comment(config.posting_key, bid.author, bid.permlink, account.name, permlink, permlink, content, '{"app":"postpromoter/' + version + '"}', function (err, result) {
      if (!err && result) {
        utils.log('Posted comment: ' + permlink);
      } else {
        logError('Error posting comment: ' + permlink);
      }
    });
  }
}

function getTransactions(callback) {
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

    if (err || !result) {
      logError('Error loading account history: ' + err);

      if (callback)
        callback();

      return;
    }

    for (var i = 0; i < result.length; i++) {
      var trans = result[i];
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
              // Bid amount is too low (make sure it's above the min_refund_amount setting)
              if(!config.min_refund_amount || amount >= config.min_refund_amount)
                refund(op[1].from, amount, currency, 'below_min_bid');
              else {
                utils.log('Invalid bid - below min bid amount and too small to refund.');
              }
            } else if (amount > max_bid) {
              // Bid amount is too high
              refund(op[1].from, amount, currency, 'above_max_bid');
            } else {
              // Bid amount is just right!
              checkPost(op[1].memo, amount, currency, op[1].from, 0);
            }
          } else if(use_delegators && op[0] == 'delegate_vesting_shares' && op[1].delegatee == account.name) {
            // If we are paying out to delegators, then update the list of delegators when new delegation transactions come in
            var delegator = delegators.find(d => d.delegator == op[1].delegator);

            if(delegator)
              delegator.vesting_shares = op[1].vesting_shares;
            else
              delegators.push({ delegator: op[1].delegator, vesting_shares: op[1].vesting_shares });

            // Save the updated list of delegators to disk
            saveDelegators();

            utils.log('*** Delegation Update - ' + op[1].delegator + ' has delegated ' + op[1].vesting_shares);
          }

          // Save the ID of the last transaction that was processed.
          last_trans = trans[0];
        }
    }

    if (callback)
      callback();
  });
}

function checkPost(memo, amount, currency, sender, retries) {
    // Parse the author and permlink from the memo URL
    var permLink = memo.substr(memo.lastIndexOf('/') + 1);
    var site = memo.substring(memo.indexOf('://')+3,memo.indexOf('/', memo.indexOf('://')+3));
    switch(site) {
      case 'd.tube':
          var author = memo.substring(memo.indexOf("/v/")+3,memo.lastIndexOf('/'));
          break;
      case 'dmania.lol':
          var author = memo.substring(memo.indexOf("/post/")+6,memo.lastIndexOf('/'));
          break;
      default:
          var author = memo.substring(memo.lastIndexOf('@') + 1, memo.lastIndexOf('/'));
    }

    if (author == '' || permLink == '') {
      refund(sender, amount, currency, 'invalid_post_url');
      return;
    }

    // Make sure the author isn't on the blacklist!
    if(config.blacklist && config.blacklist.indexOf(author) >= 0)
    {
      handleBlacklist(author, sender, amount, currency);
      return;
    }

    steem.api.getContent(author, permLink, function (err, result) {
        if (!err && result && result.id > 0) {

            // If comments are not allowed then we need to first check if the post is a comment
            if(!config.allow_comments && (result.parent_author != null && result.parent_author != '')) {
              refund(sender, amount, currency, 'no_comments');
              return;
            }

            // Check if any tags on this post are blacklisted in the settings
            if (config.blacklisted_tags && config.blacklisted_tags.length > 0 && result.json_metadata && result.json_metadata != '') {
              var tags = JSON.parse(result.json_metadata).tags;

              if (tags && tags.length > 0) {
                var tag = tags.find(t => config.blacklisted_tags.indexOf(t) >= 0);

                if(tag) {
                  refund(sender, amount, currency, 'blacklist_tag', 0, tag);
                  return;
                }
              }
            }

            var created = new Date(result.created + 'Z');

            // Get the list of votes on this post to make sure the bot didn't already vote on it (you'd be surprised how often people double-submit!)
            var votes = result.active_votes.filter(function(vote) { return vote.voter == account.name; });

            if (votes.length > 0 || (new Date() - created) >= (config.max_post_age * 60 * 60 * 1000)) {
                // This post is already voted on by this bot or the post is too old to be voted on
                refund(sender, amount, currency, ((votes.length > 0) ? 'already_voted' : 'max_age'));
                return;
            }

            // Check if this post has been flagged by any flag signal accounts
            if(config.flag_signal_accounts){
              var flags = result.active_votes.filter(function(v) { return v.percent < 0 && config.flag_signal_accounts.indexOf(v.voter) >= 0; });

              if(flags.length > 0) {
                handleFlag(sender, amount, currency);
                return;
              }
            }
        } else if(result && result.id == 0) {
          // Invalid memo
          refund(sender, amount, currency, 'invalid_post_url');
          return;
        } else {
          logError('Error loading post: ' + memo + ', Error: ' + err);

          // Try again on error
          if(retries < 2)
            setTimeout(function() { checkPost(memo, amount, currency, sender, retries + 1); }, 3000);
          else {
            utils.log('============= Load post failed three times for: ' + memo + ' ===============');

            refund(sender, amount, currency, 'invalid_post_url');
            return;
          }
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
          utils.log('Valid Bid - Amount: ' + amount + ' ' + currency + ', Title: ' + result.title);
          outstanding_bids.push({ amount: amount, currency: currency, sender: sender, author: result.author, permlink: result.permlink, url: result.url });
        }

        // If a witness_vote transfer memo is set, check if the sender votes for the bot owner as witness and send them a message if not
        if (config.transfer_memos['witness_vote'] && config.transfer_memos['witness_vote'] != '') {
          checkWitnessVote(sender, sender, currency);
        }
    });
}

function handleBlacklist(author, sender, amount, currency) {
  utils.log('Invalid Bid - @' + author + ' is on the blacklist!');

  // Refund the bid only if blacklist_refunds are enabled in config
  if (config.refund_blacklist)
    refund(sender, amount, currency, 'blacklist_refund', 0);
  else {
    // Otherwise just send a 0.001 transaction with blacklist memo
    if (config.transfer_memos['blacklist_no_refund'] && config.transfer_memos['blacklist_no_refund'] != '')
      refund(sender, 0.001, currency, 'blacklist_no_refund', 0);

    // If a blacklist donation account is specified then send funds from blacklisted users there
    if (config.blacklist_donation_account && config.blacklist_donation_account != '')
      refund(config.blacklist_donation_account, amount - 0.001, currency, 'blacklist_donation', 0);
  }
}

function handleFlag(sender, amount, currency) {
  utils.log('Invalid Bid - This post has been flagged by one or more spam / abuse indicator accounts.');

  // Refund the bid only if blacklist_refunds are enabled in config
  if (config.refund_blacklist)
    refund(sender, amount, currency, 'flag_refund', 0);
  else {
    // Otherwise just send a 0.001 transaction with blacklist memo
    if (config.transfer_memos['flag_no_refund'] && config.transfer_memos['flag_no_refund'] != '')
      refund(sender, 0.001, currency, 'flag_no_refund', 0);

    // If a blacklist donation account is specified then send funds from blacklisted users there
    if (config.blacklist_donation_account && config.blacklist_donation_account != '')
      refund(config.blacklist_donation_account, amount - 0.001, currency, 'blacklist_donation', 0);
  }
}

function checkWitnessVote(sender, voter, currency) {
  if(!config.owner_account || config.owner_account == '')
    return;

  steem.api.getAccounts([voter], function (err, result) {
    if (result && !err) {
      if (result[0].proxy && result[0].proxy != '') {
        checkWitnessVote(sender, result[0].proxy, currency);
        return;
      }

      if(result[0].witness_votes.indexOf(config.owner_account) < 0)
        refund(sender, 0.001, currency, 'witness_vote', 0);
    } else
      logError('Error loading sender account to check witness vote: ' + err);
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

function saveDelegators() {
    // Save the list of delegators to disk
    fs.writeFile('delegators.json', JSON.stringify(delegators), function (err) {
      if (err)
        utils.log('Error saving delegators to disk: ' + err);
    });
}

function refund(sender, amount, currency, reason, retries, data) {
  if(!retries)
    retries = 0;

  // Make sure refunds are enabled and the sender isn't on the no-refund list (for exchanges and things like that).
  if (!config.refunds_enabled || sender == config.account || (config.no_refund && config.no_refund.indexOf(sender) >= 0)) {
    utils.log("Invalid bid - " + reason + ' NO REFUND');
    return;
  }

  // Replace variables in the memo text
  var memo = config.transfer_memos[reason];
  memo = memo.replace(/{amount}/g, utils.format(amount, 3) + ' ' + currency);
  memo = memo.replace(/{currency}/g, currency);
  memo = memo.replace(/{min_bid}/g, config.min_bid);
  memo = memo.replace(/{max_bid}/g, config.max_bid);
  memo = memo.replace(/{account}/g, config.account);
  memo = memo.replace(/{owner}/g, config.owner_account);
  memo = memo.replace(/{tag}/g, data);

  var days = Math.floor(config.max_post_age / 24);
  var hours = (config.max_post_age % 24);
  memo = memo.replace(/{max_age}/g, days + ' Day(s)' + ((hours > 0) ? ' ' + hours + ' Hour(s)' : ''));

  // Issue the refund.
  steem.broadcast.transfer(config.active_key, config.account, sender, utils.format(amount, 3) + ' ' + currency, memo, function (err, response) {
    if (err) {
      logError('Error sending refund to @' + sender + ' for: ' + amount + ' ' + currency + ', Error: ' + err);

      // Try again on error
      if(retries < 2)
        setTimeout(function() { refund(sender, amount, currency, reason, retries + 1, data) }, (Math.floor(Math.random() * 10) + 3) * 1000);
      else
        utils.log('============= Refund failed three times for: @' + sender + ' ===============');
    } else {
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
        utils.log('Error claiming rewards...will try again next time.');
      }

      if (result) {
        if(config.detailed_logging) {
          var rewards_message = "$$$ ==> Rewards Claim";
          if (parseFloat(account.reward_sbd_balance) > 0) { rewards_message = rewards_message + ' SBD: ' + parseFloat(account.reward_sbd_balance); }
          if (parseFloat(account.reward_steem_balance) > 0) { rewards_message = rewards_message + ' STEEM: ' + parseFloat(account.reward_steem_balance); }
          if (parseFloat(account.reward_vesting_balance) > 0) { rewards_message = rewards_message + ' VESTS: ' + parseFloat(account.reward_vesting_balance); }

          utils.log(rewards_message);
        }

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

    var withdrawals = [];

    for(var i = 0; i < config.auto_withdrawal.accounts.length; i++) {
      var withdrawal_account = config.auto_withdrawal.accounts[i];

      // If this is the special $delegators account, split it between all delegators to the bot
      if(withdrawal_account.name == '$delegators') {
        // Get the total amount delegated by all delegators
        var total_vests = delegators.reduce(function (total, v) { return total + parseFloat(v.vesting_shares); }, 0);

        // Send the withdrawal to each delegator based on their delegation amount
        for(var j = 0; j < delegators.length; j++) {
          var delegator = delegators[j];

          if(has_sbd) {
            withdrawals.push({
              to: delegator.delegator,
              currency: 'SBD',
              amount: parseFloat(account.sbd_balance) * (withdrawal_account.stake / total_stake) * (parseFloat(delegator.vesting_shares) / total_vests) - 0.001
            });
          }

          if(has_steem) {
            withdrawals.push({
              to: delegator.delegator,
              currency: 'STEEM',
              amount: parseFloat(account.balance) * (withdrawal_account.stake / total_stake) * (parseFloat(delegator.vesting_shares) / total_vests) - 0.001
            });
          }
        }
      } else {
        if(has_sbd) {
          withdrawals.push({
            to: withdrawal_account.name,
            currency: 'SBD',
            amount: parseFloat(account.sbd_balance) * withdrawal_account.stake / total_stake - 0.001
          });
        }

        if(has_steem) {
          withdrawals.push({
            to: withdrawal_account.name,
            currency: 'STEEM',
            amount: parseFloat(account.balance) * withdrawal_account.stake / total_stake - 0.001
          });
        }
      }
    }

    // Check if the memo should be encrypted
    var encrypt = (config.auto_withdrawal.memo.startsWith('#') && config.memo_key && config.memo_key != '');

    if(encrypt) {
      // Get list of unique withdrawal account names
      var account_names = withdrawals.map(w => w.to).filter((v, i, s) => s.indexOf(v) === i);

      // Load account info to get memo keys for encryption
      steem.api.getAccounts(account_names, function (err, result) {
        if (result && !err) {
          for(var i = 0; i < result.length; i++) {
            var withdrawal_account = result[i];
            var matches = withdrawals.filter(w => w.to == withdrawal_account.name);

            for(var j = 0; j < matches.length; j++) {
              matches[j].memo_key = withdrawal_account.memo_key;
            }
          }

          sendWithdrawals(withdrawals);
        } else
          logError('Error loading withdrawal accounts: ' + err);
      });
    } else
      sendWithdrawals(withdrawals);
  }
}

function sendWithdrawals(withdrawals) {
  // Send out withdrawal transactions one at a time
  sendWithdrawal(withdrawals.pop(), 0, function() {
    // If there are more withdrawals, send the next one.
    if (withdrawals.length > 0)
      sendWithdrawals(withdrawals);
    else
      utils.log('========== Withdrawals Complete! ==========');
  });
}

function sendWithdrawal(withdrawal, retries, callback) {
  if(parseFloat(utils.format(withdrawal.amount, 3)) <= 0) {
    if(callback)
      callback();

    return;
  }

  var formatted_amount = utils.format(withdrawal.amount, 3).replace(/,/g, '') + ' ' + withdrawal.currency;
  var memo = config.auto_withdrawal.memo.replace(/\{balance\}/g, formatted_amount);

  // Encrypt memo
  if (memo.startsWith('#') && config.memo_key && config.memo_key != '')
    memo = steem.memo.encode(config.memo_key, withdrawal.memo_key, memo);

  // Send the withdrawal amount to the specified account
  steem.broadcast.transfer(config.active_key, config.account, withdrawal.to, formatted_amount, memo, function (err, response) {
    if (err) {
      logError('Error sending withdrawal transaction to: ' + withdrawal.to + ', Error: ' + err);

      // Try again once if there is an error
      if(retries < 1)
        setTimeout(function() { sendWithdrawal(withdrawal, retries + 1, callback); }, 3000);
      else {
        utils.log('============= Withdrawal failed two times to: ' + withdrawal.to + ' for: ' + formatted_amount + ' ===============');

        if(callback)
          callback();
      }
    } else {
      utils.log('$$$ Auto withdrawal: ' + formatted_amount + ' sent to @' + withdrawal.to);

      if(callback)
        callback();
    }
  });
}

function loadPrices() {
  if (config.currencies_accepted.length <= 1)
    return;

  // Require the "request" library for making HTTP requests
  var request = require("request");

  // Load the price feed data
  request.get('https://api.coinmarketcap.com/v1/ticker/steem/', function (e, r, data) {
    try {
      steem_price = parseFloat(JSON.parse(data)[0].price_usd);

      utils.log("Loaded STEEM price: " + steem_price);
    } catch (err) {
      utils.log('Error loading STEEM price: ' + err);
    }
  });

  // Load the price feed data
  request.get('https://api.coinmarketcap.com/v1/ticker/steem-dollars/', function (e, r, data) {
    try {
      sbd_price = parseFloat(JSON.parse(data)[0].price_usd);

      utils.log("Loaded SBD price: " + sbd_price);
    } catch (err) {
      utils.log('Error loading SBD price: ' + err);
    }
  });
}

function getUsdValue(bid) { return bid.amount * ((bid.currency == 'SBD') ? sbd_price : steem_price); }

function loadConfig() {
  // Save the existing blacklist so it doesn't get overwritten
  var blacklist = [];
  if (config && config.blacklist)
    blacklist = config.blacklist;

  config = JSON.parse(fs.readFileSync("config.json"));

  // Restore the existing blacklist in case there's an issue loading it again
  config.blacklist = blacklist;

  var location = (config.blacklist_location && config.blacklist_location != '') ? config.blacklist_location : 'blacklist';

  if (location.startsWith('http://') || location.startsWith('https://')) {
    // Require the "request" library for making HTTP requests
    var request = require("request");

    request.get(location, function (e, r, data) {
      try {
        config.blacklist = data.replace(/[\r]/g, '').split('\n');
      } catch (err) {
        utils.log('Error loading blacklist from: ' + location + ', Error: ' + err);
      }
    });
  } else if (fs.existsSync(location)) {
    config.blacklist = fs.readFileSync(location, "utf8").replace(/[\r]/g, '').split('\n');
  }
}

function failover() {
  if(config.rpc_nodes && config.rpc_nodes.length > 1) {
    var cur_node_index = config.rpc_nodes.indexOf(steem.api.options.url) + 1;

    if(cur_node_index == config.rpc_nodes.length)
      cur_node_index = 0;

    var rpc_node = config.rpc_nodes[cur_node_index];

    steem.api.setOptions({ transport: 'http', uri: rpc_node, url: rpc_node });
    utils.log('');
    utils.log('***********************************************');
    utils.log('Failing over to: ' + rpc_node);
    utils.log('***********************************************');
    utils.log('');
  }
}

var error_count = 0;
function logError(message) {
  // Don't count assert exceptions for node failover
  if (message.indexOf('assert_exception') < 0 && message.indexOf('ERR_ASSERTION') < 0)
    error_count++;

  utils.log('Error Count: ' + error_count);
  utils.log(message);
}

// Check if too many errors have happened in a 1-minute period and fail over to next rpc node
function checkErrors() {
  if(error_count >= 10)
    failover();

  // Reset the error counter
  error_count = 0;
}
setInterval(checkErrors, 60 * 1000);
