const express = require('express');
const crypto = require('crypto');
const { WebClient } = require('@slack/web-api');

const app = express();
app.use(express.raw({ type: 'application/json' }));

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const NOTIFICATION_CHANNEL_ID = process.env.NOTIFICATION_CHANNEL_ID;
const KAMBARA_USER_ID = process.env.KAMBARA_USER_ID;
const TEST_USER_ID = process.env.TEST_USER_ID;
const OKUBO_USER_ID = 'U06RVT4MDFX';
const TARGET_REACTION = 'okubo_taiou';

const slackClient = new WebClient(SLACK_BOT_TOKEN);

function verifySlackSignature(req) {
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  const body = req.body.toString();
  const baseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', SLACK_SIGNING_SECRET);
  const expectedSignature = 'v0=' + hmac.update(baseString).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

app.post('/slack/events', async (req, res) => {
  const body = JSON.parse(req.body.toString());

  if (body.type === 'url_verification') {
    return res.json({ challenge: body.challenge });
  }

  if (!verifySlackSignature(req)) {
    return res.status(401).send('Invalid signature');
  }

  res.status(200).send('OK');

  if (body.event && body.event.type === 'reaction_added') {
    const event = body.event;

    if ((event.user === KAMBARA_USER_ID || event.user === TEST_USER_ID) && event.reaction === TARGET_REACTION) {
      try {
        const result = await slackClient.conversations.history({
          channel: event.item.channel,
          latest: event.item.ts,
          limit: 1,
          inclusive: true
        });

        const originalMessage = result.messages[0];
        const messageLink = `https://slack.com/archives/${event.item.channel}/p${event.item.ts.replace('.', '')}`;

        const notificationText = `【作業担当】<@${OKUBO_USER_ID}>\n${originalMessage.text}\n${messageLink}`;

        await slackClient.chat.postMessage({
          channel: NOTIFICATION_CHANNEL_ID,
          text: notificationText,
          unfurl_links: false,
          unfurl_media: false
        });

        console.log('通知送信完了');
      } catch (error) {
        console.error('エラー:', error);
      }
    }
  }
});

app.get('/', (req, res) => {
  res.send('Slack Reaction Notifier is running');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
