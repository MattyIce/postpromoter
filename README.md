# Post Promoter - Steem Bid-Based Voting Bot

## Installation
``` npm install postpromoter ```

## Configuration

```
{
  "account": "yourbotaccount",
  "min_bid": 0.1,
  "max_bid": 999,
  "max_post_age": 144,
  "allow_comments": true,
  "promotion_content": "You got a {weight}% upvote from @postpromoter courtesy of @{sender}!"
}
```

## Run
```
node index.js [posting_key]
```
