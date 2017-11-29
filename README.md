# Post Promoter - Steem Bid-Based Voting Bot

## Installation
``` 
$ git clone https://github.com/MattyIce/postpromoter.git
```

## Configuration
Set the POSTING_KEY environment variable to the private posting key of the bot account:
```
export POSTING_KEY=[posting_key]
```

Set the following options in config.json:
```
{
  "account": "yourbotaccount",
  "min_bid": 0.1,
  "max_bid": 999,
  "max_post_age": 144, // In hours, 144 hours = 6 days
  "allow_comments": true,
  "promotion_content": "You got a {weight}% upvote from @postpromoter courtesy of @{sender}!" // Change this to whatever you want the bot to post as a comment when it votes, or leave it out or blank for no comment
}
```

## Run
```
node postpromoter.js
```
