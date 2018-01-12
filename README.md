# Post Promoter - Steem Bid-Based Voting Bot

## Installation
```
$ git clone https://github.com/MattyIce/postpromoter.git
$ npm install
```

## Configuration
First rename config-example.json to config.json:
```
$ mv config-example.json config.json
```

Then set the following options in config.json:
```
{
  "rpc_node": "https://api.steemit.com", // Set the RPC node you would like to connect to (https://api.steemit.com is the default if this is not set)
  "disabled_mode": false, // Set this to true to refund all funds sent to the bot
  "detailed_logging": false, // Whether or not detailed logging is enabled
  "account": "yourbotaccount",
  "memo_key": "your_private_memo_key"
  "posting_key": "your_private_posting_key",
  "active_key": "your_private_active_key",
  "auto_claim_rewards" : true, // Set to false if you dont want to claim rewards automatical
  "post_rewards_withdrawal_account": "account_name", // Automatically withdraw any liquid post rewards to the specified account
  "min_bid": 0.1,
  "max_bid": 999,
  "batch_vote_weight": 100,
  "max_post_age": 144, // In hours, 144 hours = 6 days
  "allow_comments": true,
  "currencies_accepted": ["SBD", "STEEM"], // Which currencies to accept
  "blacklist": ["account1", "account2"], // List of blacklisted accounts
  "refunds_enabled": true,
  "no_refund": ["bittrex", "poloniex", "openledger", "blocktrades", "minnowbooster"], // Don't refund transactions from these accounts!
  "promotion_content": "You got a {weight}% upvote from @{botname} courtesy of @{sender}!", // Change this to whatever you want the bot to post as a comment when it votes, or leave it out or blank for no comment
  "auto_withdrawal": {
    "active": true, // Activate the auto withdrawal function (will withdraw all accepted currencies)
    "accounts": [	// List of accounts to receive daily withdrawals and the amount to send to each
      {
        "name": "$delegators",  // Use the special name '$delegators' to split this portion of the payout among all delegators to the account based on the amount of their delegation
        "stake": 8000
      },
      {
        "name": "account2",
        "stake": 2000
      }
    ],
	"frequency": "daily", // This can be "daily" for withdrawals once per day or "round_end" for withdrawals after every bidding round
    "execute_time": 20, // Hour of the day to execute the withdrawal (0 - 23)
    "memo": "#Today generated SBD - {balance} | Thank you." // Transaction memo, start with # if you want it encrypted
  },
  "api": {  // This will expose an API endpoint for information about bids in each round
    "enabled": true,
    "port": 3000
  },
  "transfer_memos": {	// Memos sent with transfer for bid refunds
      "bot_disabled": "Refund for invalid bid: {amount} - The bot is currently disabled.",
      "below_min_bid": "Refund for invalid bid: {amount} - Min bid amount is {min_bid}.",
      "above_max_bid": "Refund for invalid bid: {amount} - Max bid amount is {max_bid}.",
      "invalid_currency": "Refund for invalid bid: {amount} - Bids in {currency} are not accepted.",
      "no_comments": "Refund for invalid bid: {amount} - Bids not allowed on comments.",
      "already_voted": "Refund for invalid bid: {amount} - Bot already voted on this post.",
      "max_age": "Refund for invalid bid: {amount} - Posts cannot be older than {max_age}.",
      "invalid_post_url": "Refund for invalid bid: {amount} - Invalid post URL in memo."
  }
}
```

## Run
```
$ nodejs postpromoter.js
```

## API Setup
If you would like to use the API functionality set the "api.enabled" setting to "true" and choose a port. You can test if it is working locally by running:

```
$ curl http://localhost:port/api/bids
```

If that returns a JSON object with bids then it is working.

It is recommended to set up an nginx reverse proxy server (or something similar) to forward requests on port 80 to the postpromoter nodejs server. For instructions on how to do that please see: https://medium.com/@utkarsh_verma/configure-nginx-as-a-web-server-and-reverse-proxy-for-nodejs-application-on-aws-ubuntu-16-04-server-872922e21d38

In order to be used on the bot tracker website it will also need an SSL certificate. For instructions to get and install a free SSL certificate see: https://certbot.eff.org/
