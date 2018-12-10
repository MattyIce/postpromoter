var fs = require("fs");
var dsteem = require('dsteem');

var STEEMIT_100_PERCENT = 10000;
var STEEMIT_VOTE_REGENERATION_SECONDS = (5 * 60 * 60 * 24);
var HOURS = 60 * 60;

 var steemPrice;
 var rewardBalance;
 var recentClaims;
 var currentUserAccount;
 var votePowerReserveRate;
 var totalVestingFund;
 var totalVestingShares;
 var steem_per_mvests;
 var sbd_print_percentage;

 function updateSteemVariables(client) {
    client.database.call('get_reward_fund', ['post']).then(function (t) {
      rewardBalance = parseFloat(t.reward_balance.replace(" STEEM", ""));
      recentClaims = t.recent_claims;
    }, function(e) {
      log('Error loading reward fund: ' + e);
    });

    client.database.getCurrentMedianHistoryPrice().then(function (t) {
      steemPrice = parseFloat(t.base) / parseFloat(t.quote);
    }, function(e) {
      log('Error loading steem price: ' + e);
    });

    client.database.getDynamicGlobalProperties().then(function (t) {
      votePowerReserveRate = t.vote_power_reserve_rate;
      totalVestingFund = parseFloat(t.total_vesting_fund_steem.replace(" STEEM", ""));
      totalVestingShares = parseFloat(t.total_vesting_shares.replace(" VESTS", ""));
      steem_per_mvests = ((totalVestingFund / totalVestingShares) * 1000000);
      sbd_print_percentage = t.sbd_print_rate / 10000
    }, function (e) {
      log('Error loading global properties: ' + e);
    });

    setTimeout(function() { updateSteemVariables(client); }, 180 * 1000)
 }

 function vestsToSP(vests) { return vests / 1000000 * steem_per_mvests; }

 function getVotingPower(account) {
     var voting_power = account.voting_power;
     var last_vote_time = new Date((account.last_vote_time) + 'Z');
     var elapsed_seconds = (new Date() - last_vote_time) / 1000;
     var regenerated_power = Math.round((STEEMIT_100_PERCENT * elapsed_seconds) / STEEMIT_VOTE_REGENERATION_SECONDS);
     var current_power = Math.min(voting_power + regenerated_power, STEEMIT_100_PERCENT);
     return current_power;
 }

 function getVPHF20(account) {
	var totalShares = parseFloat(account.vesting_shares) + parseFloat(account.received_vesting_shares) - parseFloat(account.delegated_vesting_shares);

	var elapsed = Date.now() / 1000 - account.voting_manabar.last_update_time;
	var maxMana = totalShares * 1000000;
	// 432000 sec = 5 days
	var currentMana = parseFloat(account.voting_manabar.current_mana) + elapsed * maxMana / 432000;
	
	if (currentMana > maxMana) {
		currentMana = maxMana;
	}

	var currentManaPerc = currentMana * 100 / maxMana;

	return Math.round(currentManaPerc * 100);
 }

 function getVoteRShares(voteWeight, account, power) {
     if (!account) {
         return;
     }

     if (rewardBalance && recentClaims && steemPrice && votePowerReserveRate) {

         var effective_vesting_shares = Math.round(getVestingShares(account) * 1000000);
         var voting_power = account.voting_power;
         var weight = voteWeight * 100;
         var last_vote_time = new Date((account.last_vote_time) + 'Z');


         var elapsed_seconds = (new Date() - last_vote_time) / 1000;
         var regenerated_power = Math.round((STEEMIT_100_PERCENT * elapsed_seconds) / STEEMIT_VOTE_REGENERATION_SECONDS);
         var current_power = power || Math.min(voting_power + regenerated_power, STEEMIT_100_PERCENT);
         var max_vote_denom = votePowerReserveRate * STEEMIT_VOTE_REGENERATION_SECONDS / (60 * 60 * 24);
         var used_power = Math.round((current_power * weight) / STEEMIT_100_PERCENT);
         used_power = Math.round((used_power + max_vote_denom - 1) / max_vote_denom);

         var rshares = Math.round((effective_vesting_shares * used_power) / (STEEMIT_100_PERCENT))

         return rshares;

     }
 }

 function getVoteValue(voteWeight, account, power, steem_price) {
     if (!account) {
         return;
     }
     if (rewardBalance && recentClaims && steemPrice && votePowerReserveRate) {
         var voteValue = getVoteRShares(voteWeight, account, power)
           * rewardBalance / recentClaims
           * steem_price;

         return voteValue;

     }
 }

 function getVoteValueUSD(vote_value, sbd_price) {
  const steempower_value = vote_value * 0.5
  const sbd_print_percentage_half = (0.5 * sbd_print_percentage)
  const sbd_value = vote_value * sbd_print_percentage_half
  const steem_value = vote_value * (0.5 - sbd_print_percentage_half)
  return (sbd_value * sbd_price) + steem_value + steempower_value
 }

function timeTilFullPower(cur_power){
     return (STEEMIT_100_PERCENT - cur_power) * STEEMIT_VOTE_REGENERATION_SECONDS / STEEMIT_100_PERCENT;
 }

 function getVestingShares(account) {
     var effective_vesting_shares = parseFloat(account.vesting_shares.replace(" VESTS", ""))
       + parseFloat(account.received_vesting_shares.replace(" VESTS", ""))
       - parseFloat(account.delegated_vesting_shares.replace(" VESTS", ""));
     return effective_vesting_shares;
 }

 function getCurrency(amount) {
   return amount.substr(amount.indexOf(' ') + 1);
 }

function loadUserList(location, callback) {
  if(!location) {
    if(callback)
      callback(null);

    return;
  }

  if (location.startsWith('http://') || location.startsWith('https://')) {
    // Require the "request" library for making HTTP requests
    var request = require("request");

    request.get(location, function (e, r, data) {
      try {
        if(callback)
          callback(data.replace(/[\r]/g, '').split('\n'));
      } catch (err) {
        log('Error loading blacklist from: ' + location + ', Error: ' + err);

        if(callback)
          callback(null);
      }
    });
  } else if (fs.existsSync(location)) {
    if(callback)
      callback(fs.readFileSync(location, "utf8").replace(/[\r]/g, '').split('\n'));
  } else if(callback)
    callback([]);
}

function format(n, c, d, t) {
  var c = isNaN(c = Math.abs(c)) ? 2 : c,
      d = d == undefined ? "." : d,
      t = t == undefined ? "," : t,
      s = n < 0 ? "-" : "",
      i = String(parseInt(n = Math.abs(Number(n) || 0).toFixed(c))),
      j = (j = i.length) > 3 ? j % 3 : 0;
   return s + (j ? i.substr(0, j) + t : "") + i.substr(j).replace(/(\d{3})(?=\d)/g, "$1" + t) + (c ? d + Math.abs(n - i).toFixed(c).slice(2) : "");
 }

 function toTimer(ts) {
   var h = Math.floor(ts / HOURS);
   var m = Math.floor((ts % HOURS) / 60);
   var s = Math.floor((ts % 60));
   return padLeft(h, 2) + ':' + padLeft(m, 2) + ':' + padLeft(s, 2);
 }

 function padLeft(v, d) {
   var l = (v + '').length;
   if (l >= d) return v + '';
   for(var i = l; i < d; i++)
     v = '0' + v;
   return v;
 }

 function log(msg) { console.log(new Date().toString() + ' - ' + msg); }

 module.exports = {
   updateSteemVariables: updateSteemVariables,
   getVotingPower: getVotingPower,
   getVoteValue: getVoteValue,
   getVoteValueUSD: getVoteValueUSD,
   timeTilFullPower: timeTilFullPower,
   getVestingShares: getVestingShares,
	 vestsToSP: vestsToSP,
   loadUserList: loadUserList,
   getCurrency: getCurrency,
   format: format,
   toTimer: toTimer,
	 log: log,
	 getVPHF20: getVPHF20
 }
