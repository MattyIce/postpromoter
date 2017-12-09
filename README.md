# Post Promoter - Steem Bid-Based Voting Bot

## Installation
```
$ git clone https://github.com/MattyIce/postpromoter.git
```

## Configuration
First rename config-example.json to config.json:
```
$ mv config-example.json config.json
```

Then set the following options in config.json:
```
{
  "disabled_mode": false, // Set this to true to refund all funds sent to the bot
  "account": "yourbotaccount",
  "memo_key": "your_private_memo_key"
  "posting_key": "your_private_posting_key",
  "active_key": "your_private_active_key",
  "auto_claim_rewards" : true, // Set to false if you dont want to claim rewards automatical
  "min_bid": 0.1,
  "max_bid": 999,
  "batch_vote_weight": 100,
  "max_post_age": 144, // In hours, 144 hours = 6 days
  "allow_comments": true,
  "currencies_accepted": ["SBD", "STEEM"], // Which currencies to accept
  "blacklist": ["account1", "account2"], // List of blacklisted accounts
  "refunds_enabled": true,
  "no_refund": ["bittrex", "poloniex", "openledger", "blocktrades"], // Don't refund transactions from these accounts!
  "promotion_content": "You got a {weight}% upvote from @{botname} courtesy of @{sender}!", // Change this to whatever you want the bot to post as a comment when it votes, or leave it out or blank for no comment
  "auto_withdrawal": {
    "active": true, // Activate the auto withdrawal function (will withdraw all accepted currencies)
    "to_account": "account_to_receive", // account to receive
    "execute_time": 20, // Hour of the day to execute the withdrawal (0 - 23)
    "memo": "#Today generated SBD - {balance} | Thank you." // Transaction memo, start with # if you want it encrypted
  },
  "api": {  // This will expose an API endpoint for information about bids in each round
    "enabled": true,
    "port": 3000
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
