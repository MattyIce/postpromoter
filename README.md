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
  "rpc_nodes": // Set the list of RPC nodes you would like to connect to (https://api.steemit.com is the default if this is not set). The software will automatically fail over to the next node on the list if the current one is having issues.
  [
    "https://api.steemit.com",
    "https://rpc.buildteam.io",
    "https://steemd.minnowsupportproject.org",
    "https://steemd.privex.io",
    "https://gtg.steem.house:8090"
  ],
  "disabled_mode": false, // Set this to true to refund all funds sent to the bot
  "detailed_logging": false, // Whether or not detailed logging is enabled
  "owner_account": "bot_owner_account", // The name of the bot owner account (can be left null or blank)
  "account": "yourbotaccount",
  "memo_key": "your_private_memo_key"
  "posting_key": "your_private_posting_key",
  "active_key": "your_private_active_key",
  "auto_claim_rewards" : true, // Set to false if you don't want to claim rewards automatically
  "post_rewards_withdrawal_account": "account_name", // Automatically withdraw any liquid post rewards to the specified account
  "min_bid": 0.1,
  "max_bid": 999,
  "round_fill_limit": 0.9,  // Limit the round to 90% full to guarantee a minimum of 10% ROI for all bidders
  "batch_vote_weight": 100,
  "min_post_age": 20, // In minutes, minimum age of post that will be accepted
  "max_post_age": 144, // In hours, 144 hours = 6 days
  "allow_comments": true,
  "currencies_accepted": ["SBD", "STEEM"], // Which currencies to accept
  "refunds_enabled": true,
  "min_refund_amount": 0.002, // This will prevent refunds for transfer memos
  "no_refund": ["bittrex", "poloniex", "openledger", "blocktrades", "minnowbooster"], // Don't refund transactions from these accounts!
  "flag_signal_accounts": ["spaminator", "cheetah", "steemcleaners", "mack-bot", "blacklist-a"], // If any accounts on this list has flagged the post at the time the bid comes in it will be treated as blacklisted
  "comment_location": "comment.md", // The location of a markdown file containing the comment that should be left after the bot votes on a post. Leave this null or blank for no comment.
  "blacklist_location": "blacklist", // The location of the blacklist file containing one blacklisted Steem account name per line
  "refund_blacklist": true,	// Whether or not to refund blacklisted users' bids
  "blacklist_donation_account": "steemcleaners", // If "refund_blacklist" is false, then this will send all bids from blacklisted users to the specified account as a donation
  "blacklisted_tags": ["nsfw", "other-tag"], // List of post tags that are not allowed by the bot. Bids for posts with one or more tags in this list will be refunded
  "max_per_author_per_round": 1, // Limit to the number of posts that can be voted on for a particular author each round
  "auto_withdrawal": {
    "active": true, // Activate the auto withdrawal function (will withdraw all accepted currencies)
    "accounts": [	// List of accounts to receive daily withdrawals and the amount to send to each
      {
        "name": "$delegators",  // Use the special name '$delegators' to split this portion of the payout among all delegators to the account based on the amount of their delegation
        "stake": 8000,
        "overrides": [  // Specify a beneficiary account for payments for certain delegators
          { "name": "delegator_account", "beneficiary": "beneficiary_account" }
        ]
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
    "min_age": "Refund for invalid bid: {amount} - Posts cannot be less than {min_age} minutes old.",
    "invalid_post_url": "Refund for invalid bid: {amount} - Invalid post URL in memo.",
    "blacklist_refund": "Refund for invalid bid: {amount} - The author of this post is on the blacklist.",
    "blacklist_no_refund": "Bid is invalid - The author of this post is on the blacklist.",
    "blacklist_donation": "Bid from blacklisted user sent as a donation. Thank you!",
    "flag_refund": "Refund for invalid bid: {amount} - This post has been flagged by one or more spam / abuse indicator accounts.",
    "flag_no_refund": "Bid is invalid - This post has been flagged by one or more spam / abuse indicator accounts.",
    "blacklist_tag": "Bid is invalid - This post contains the [{tag}] tag which is not allowed by this bot.",
    "bids_per_round": "Bid is invalid - This author already has the maximum number of allowed bids in this round.",
    "round_full": "The current bidding round is full. Please try again next round!"
  }
}
```

### Blacklist
You can add a list of blacklisted users whose bids will not be accepted and who will not receive any refund by adding their steem account name to the "blacklist" file. Set the "blacklist_location" property to point to the location of your blacklist file, or you can use a URL to point to a shared blacklist on the internet. The file should contain only one steem account name on each line and nothing else as in the following example:

```
blacklisted_account_1
blacklisted_account_2
blacklisted_account_3
```

Additionally you can add a list of "flag_signal_accounts" which means that if any accounts on that list have flagged the post at the time the bid is sent then the bot will treat it as blacklisted.

## Run
```
$ nodejs postpromoter.js
```

This will run the process in the foreground which is not recommended. We recommend using a tool such as [PM2](http://pm2.keymetrics.io/) to run the process in the background as well as providing many other great features.

## API Setup
If you would like to use the API functionality set the "api.enabled" setting to "true" and choose a port. You can test if it is working locally by running:

```
$ curl http://localhost:port/api/bids
```

If that returns a JSON object with bids then it is working.

It is recommended to set up an nginx reverse proxy server (or something similar) to forward requests on port 80 to the postpromoter nodejs server. For instructions on how to do that please see: https://medium.com/@utkarsh_verma/configure-nginx-as-a-web-server-and-reverse-proxy-for-nodejs-application-on-aws-ubuntu-16-04-server-872922e21d38

In order to be used on the bot tracker website it will also need an SSL certificate. For instructions to get and install a free SSL certificate see: https://certbot.eff.org/
