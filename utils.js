const fs = require('fs');
//const dsteem = require('dsteem');


const STEEMIT_100_PERCENT = 10000;
const STEEMIT_VOTE_REGENERATION_SECONDS = (5 * 60 * 60 * 24);
const HOURS = 60 * 60;

 let steemPrice;
 let rewardBalance;
 let recentClaims;
// let currentUserAccount;
 let votePowerReserveRate;
 let totalVestingFund;
 let totalVestingShares;
 let steem_per_mvests;
 let sbd_print_percentage;

 function updateSteemVariables(client) {
    client.database.call('get_reward_fund', ['post']).then(function (t) {
      rewardBalance = parseFloat(t['reward_balance'].replace(" STEEM", ""));
      recentClaims = t['recent_claims'];
    }, function(e) {
      log('Error loading reward fund: ' + e);
    });

    client.database.getCurrentMedianHistoryPrice().then(function (t) {
      steemPrice = parseFloat(t['base']) / parseFloat(t['quote']);
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

 /*
 function getVotingPower(account) {
     let voting_power = account.voting_power;
     let last_vote_time = new Date((account.last_vote_time) + 'Z');
     let elapsed_seconds = (new Date() - last_vote_time) / 1000;
     let regenerated_power = Math.round((STEEMIT_100_PERCENT * elapsed_seconds) / STEEMIT_VOTE_REGENERATION_SECONDS);
     return Math.min(voting_power + regenerated_power, STEEMIT_100_PERCENT);
 }*/

 function getVPHF20(account) {
	let totalShares = parseFloat(account.vesting_shares) + parseFloat(account.received_vesting_shares) - parseFloat(account.delegated_vesting_shares);

	let elapsed = Date.now() / 1000 - account['voting_manabar']['last_update_time'];
	let maxMana = totalShares * 1000000;
	// 432000 sec = 5 days
	let currentMana = parseFloat(account['voting_manabar']['current_mana']) + elapsed * maxMana / 432000;
	
	if (currentMana > maxMana) {
		currentMana = maxMana;
	}

	let currentManaPerc = currentMana * 100 / maxMana;

	return Math.round(currentManaPerc * 100);
 }

 function getVoteRShares(voteWeight, account, power) {
     if (!account) {
         return;
     }

     if (rewardBalance && recentClaims && steemPrice && votePowerReserveRate) {

         let effective_vesting_shares = Math.round(getVestingShares(account) * 1000000);
         let voting_power = account.voting_power;
         let weight = voteWeight * 100;
         let last_vote_time = new Date((account.last_vote_time) + 'Z');


         let elapsed_seconds = (new Date() - last_vote_time) / 1000;
         let regenerated_power = Math.round((STEEMIT_100_PERCENT * elapsed_seconds) / STEEMIT_VOTE_REGENERATION_SECONDS);
         let current_power = power || Math.min(voting_power + regenerated_power, STEEMIT_100_PERCENT);
         let max_vote_denom = votePowerReserveRate * STEEMIT_VOTE_REGENERATION_SECONDS / (60 * 60 * 24);
         let used_power = Math.round((current_power * weight) / STEEMIT_100_PERCENT);
         used_power = Math.round((used_power + max_vote_denom - 1) / max_vote_denom);

         return Math.round((effective_vesting_shares * used_power) / (STEEMIT_100_PERCENT));

     }
 }

 function getVoteValue(voteWeight, account, power, steem_price) {
     if (!account) {
         return;
     }
     if (rewardBalance && recentClaims && steemPrice && votePowerReserveRate) {
         return getVoteRShares(voteWeight, account, power)
           * rewardBalance / recentClaims
           * steem_price;

     }
 }

 function getVoteValueUSD(vote_value, sbd_price) {
  const steempower_value = vote_value * 0.5;
  const sbd_print_percentage_half = (0.5 * sbd_print_percentage);
  const sbd_value = vote_value * sbd_print_percentage_half;
  const steem_value = vote_value * (0.5 - sbd_print_percentage_half);
  return (sbd_value * sbd_price) + steem_value + steempower_value;
 }

function timeTilFullPower(cur_power){
     return (STEEMIT_100_PERCENT - cur_power) * STEEMIT_VOTE_REGENERATION_SECONDS / STEEMIT_100_PERCENT;
 }

 function getVestingShares(account) {
     return parseFloat(account.vesting_shares.replace(" VESTS", ""))
       + parseFloat(account.received_vesting_shares.replace(" VESTS", ""))
       - parseFloat(account.delegated_vesting_shares.replace(" VESTS", ""));
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
    let request = require("request");

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
      c = isNaN(c = Math.abs(c)) ? 2 : c;
      d = d === undefined ? "." : d;
      t = t === undefined ? "," : t;
  let s = n < 0 ? "-" : "",
      i = String(parseInt(n = Math.abs(Number(n) || 0).toFixed(c))),
      j = (i.length > 3) ? (i % 3) : 0;
   return s + (j ? i.substr(0, j) + t : "") + i.substr(j).replace(/(\d{3})(?=\d)/g, "$1" + t) + (c ? d + Math.abs(n - i).toFixed(c).slice(2) : "");
 }

 function toTimer(ts) {
   let h = Math.floor(ts / HOURS);
   let m = Math.floor((ts % HOURS) / 60);
   let s = Math.floor((ts % 60));
   return padLeft(h, 2) + ':' + padLeft(m, 2) + ':' + padLeft(s, 2);
 }

 function padLeft(v, d) {
   let l = (v + '').length;
   if (l >= d) return v + '';
   for(let i = l; i < d; i++)
     v = '0' + v;
   return v;
 }

 function log(msg) { console.log(new Date().toString() + ' - ' + msg); }

 module.exports = {
   updateSteemVariables: updateSteemVariables,
//   getVotingPower: getVotingPower,
   getVoteValue: getVoteValue,
   getVoteValueUSD: getVoteValueUSD,
   timeTilFullPower: timeTilFullPower,
//   getVestingShares: getVestingShares,
	 vestsToSP: vestsToSP,
   loadUserList: loadUserList,
   getCurrency: getCurrency,
   format: format,
   toTimer: toTimer,
	 log: log,
	 getVPHF20: getVPHF20
 };