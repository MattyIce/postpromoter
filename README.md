# Post Promoter - Steem Bid-Based Voting Bot with Tag Promotion

 This is a fork from @MattyIce/postpromoter. I add a feature called `Tag Promotion` which will enable voting weight bonus on specific tags. I believe this feature can add more diversity to the Voting bots and actually helps the Steem Community.

The script is currently running on a bot called [@bidseption on Steemit](https://steemit.com/@bidseption). If you like the feature and you're running a bot with this script, you can let me know and I'll list your bot's name here :)


## Installation
```
$ git clone https://github.com/antoncoding/postpromoter.git
$ npm install
```

## Configuration
First rename config-example.json to config.json:
```
$ mv config-example.json config.json
```

Then set the following options in `config.json`:

Most of the settings are the same with @MattyIce's repo, so you can find setting details in his README file [here](https://github.com/MattyIce/postpromoter). To enable the `Tag Promotion` feature and do some customer settings, you just have to edit the following options

```
"allow_tag_promotion": true, # enable the feature
"promoted_tags":["blockchain","neo","cn"], # List if tags you want to promote
"promote_ratio": 0.5, # this means a 50% bonus on incoming bids
```

### Blacklist
You can add a list of blacklisted users whose bids will not be accepted and who will not receive any refund by adding their steem account name to the "blacklist" file. (You can also find more detail on @MattyIce's repo):

```
blacklisted_account_1
blacklisted_account_2
blacklisted_account_3
```

## Run
```
$ nodejs postpromoter.js
```

This will run the process in the foreground which is not recommended. We recommend using a tool such as [PM2](http://pm2.keymetrics.io/) to run the process in the background as well as providing many other great features.

## Contributions and Discussions
If you have any good ideas or suggestions about how to improve the bot, you can either comment on @bidseption's post on Steem, or open an issue here on GitHub. You can also submit a pull request directly.

## Donations
STEEM: @antonsteemit
