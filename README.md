# Post Promoter - Steem Bid-Based Voting Bot

## Installation
```
$ git clone https://github.com/MattyIce/postpromoter.git
```

## Configuration

Set the following options in config.json:
```
{
  "disabled_mode": false, // Set this to true to refund all funds sent to the bot
  "account": "yourbotaccount",
  "posting_key": "your_posting_key",
  "active_key": "your_active_key",
  "auto_claim_rewards" : true, // Set to false if you dont want to claim rewards automatical
  "min_bid": 0.1,
  "max_bid": 999,
  "batch_vote_weight": 100,
  "max_post_age": 144, // In hours, 144 hours = 6 days
  "allow_comments": true,
  "blacklist": ["account1", "account2"], // List of blacklisted accounts
  "refunds_enabled": true,
  "no_refund": ["bittrex", "poloniex", "openledger", "blocktrades"], // Don't refund transactions from these accounts!
  "promotion_content": "You got a {weight}% upvote from @{botname} courtesy of @{sender}!", // Change this to whatever you want the bot to post as a comment when it votes, or leave it out or blank for no comment
  "auto_withdrawal": {
    "active": true, // Activate the auto withdrawal function
    "to_account": "account_to_receive", // account to receive 
    "execute_time": "20:00:00", // Time to be executed
    "memo": "#Today generated SBD - {balance} | Thank you." // Transaction memo
  }
}
```

## Run
```
$ nodejs postpromoter.js
```
