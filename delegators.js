//const steem = require('steem');
let utils = require('./utils');
//let dsteem = require('dsteem');

let delegation_transactions = [];

function loadDelegations(client, account, callback) {
  getTransactions(client, account, -1, callback);
}

function getTransactions(client, account, start, callback) {
  let last_trans = start;
	utils.log('Loading history for delegators at transaction: ' + (start < 0 ? 'latest' : start));
  
  client.database.call('get_account_history', [account, start, (start < 0) ? 10000 : Math.min(start, 10000)]).then(function (result) {
    result.reverse();

		for(let i = 0; i < result.length; i++) {
			let trans = result[i];
      let op = trans[1].op;

      if(op[0] === 'delegate_vesting_shares' && op[1].delegatee === account)
        delegation_transactions.push({ id: trans[0], data: op[1] });

      // Save the ID of the last transaction that was processed.
      last_trans = trans[0];
    }
		
    if(last_trans > 0 && last_trans !== start)
      getTransactions(client, account, last_trans, callback);
    else {
			if(last_trans > 0) {
				utils.log('********* ALERT - Full account history not available from this node, not all delegators may have been loaded!! ********');
				utils.log('********* Last available transaction was: ' + last_trans + ' ********');
			}
			
      processDelegations(callback);
		}
  }, function(err) { console.log('Error loading account history for delegations: ' + err); });
}

function processDelegations(callback) {
  let delegations = [];

  // Go through the delegation transactions from oldest to newest to find the final delegated amount from each account
  delegation_transactions.reverse();

  for(let i = 0; i < delegation_transactions.length; i++) {
    let trans = delegation_transactions[i];

    // Check if this is a new delegation or an update to an existing delegation from this account
    let delegation = delegations.find(d => d.delegator === trans.data.delegator);

    if(delegation) {
      delegation.vesting_shares = trans.data.vesting_shares;
    } else {
      delegations.push({ delegator: trans.data.delegator, vesting_shares: trans.data.vesting_shares });
    }
  }

  delegation_transactions = [];

  // Return a list of all delegations (and filter out any that are 0)
  if(callback)
    callback(delegations.filter(function(d) { return parseFloat(d.vesting_shares) > 0; }));
}

module.exports = {
  loadDelegations: loadDelegations
};
