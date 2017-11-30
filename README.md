# Post Promoter - Steem Bid-Based Voting Bot

## Installation
```
$ git clone https://github.com/MattyIce/postpromoter.git
```

## Configuration
Set the POSTING_KEY and ACTIVE_KEY environment variables to the private posting and active keys of the bot account. Active key is only required for refunds.
```
export POSTING_KEY=[posting_key]
export ACTIVE_KEY=[active_key]
```

Set the following options in config.json:
```
{
  "disabled_mode": false, // Set this to true to refund all funds sent to the bot
  "account": "yourbotaccount",
  "min_bid": 0.1,
  "max_bid": 999,
  "batch_vote_weight": 100,
  "max_post_age": 144, // In hours, 144 hours = 6 days
  "allow_comments": true,
  "blacklist": ["account1", "account2"], // List of blacklisted accounts
  "refunds_enabled": true,
  "no_refund": ["bittrex", "poloniex", "openledger", "blocktrades"], // Don't refund transactions from these accounts!
  "promotion_content": "You got a {weight}% upvote from @postpromoter courtesy of @{sender}!" // Change this to whatever you want the bot to post as a comment when it votes, or leave it out or blank for no comment
}
```

## Run
```
node postpromoter.js
```
