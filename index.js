const express = require('express');
const crypto = require('crypto');
const { WebClient } = require('@slack/web-api');
const app = express();
app.use(express.raw({ type: 'application/json' }));

// 環境変数
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const NOTIFICATION_CHANNEL_ID = process.env.NOTIFICATION_CHANNEL_ID;
const KAMBARA_USER_ID = process.env.KAMBARA_USER_ID;
const TEST_USER_ID = process.env.TEST_USER_ID;
const OKUBO_USER_ID = 'U06RVT4MDFX';
const TARGET_REACTION = 'okubo_taiou';

const slackClient = new WebClient(SLACK_BOT_TOKEN);

// 署名検証
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

// 今日のJST日付文字列を取得（例: "2026-03-16"）
function getTodayJST() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

// 通知チャンネルから当日の親メッセージTSを検索
async function findTodayParentTS() {
  const today = getTodayJST();
  const result = await slackClient.conversations.history({
    channel: NOTIFICATION_CHANNEL_ID,
    limit: 20
  });

  for (const msg of result.messages) {
    // Botの投稿 かつ 当日 かつ スレッド親（thread_tsが自分自身）かつ マーカーテキスト含む
    if (
      msg.bot_id &&
      msg.text.includes('【作業担当】') &&
      msg.text.includes(today) &&
      (!msg.thread_ts || msg.thread_ts === msg.ts)
    ) {
      return msg.ts;
    }
  }
  return null;
}

// メイン処理
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
        // 元メッセージ取得
        let originalMessage;
        const result = await slackClient.conversations.history({
          channel: event.item.channel,
          latest: event.item.ts,
          limit: 1,
          inclusive: true
        });
        originalMessage = result.messages[0];

        if (!originalMessage || originalMessage.ts !== event.item.ts) {
          const threadResult = await slackClient.conversations.replies({
            channel: event.item.channel,
            ts: event.item.ts,
            latest: event.item.ts,
            limit: 1,
            inclusive: true
          });
          originalMessage = threadResult.messages[0];
        }

        // メッセージリンク作成
        let messageLink;
        if (originalMessage.thread_ts && originalMessage.thread_ts !== originalMessage.ts) {
          messageLink = `https://slack.com/archives/${event.item.channel}/p${event.item.ts.replace('.', '')}?thread_ts=${originalMessage.thread_ts}&cid=${event.item.channel}`;
        } else {
          messageLink = `https://slack.com/archives/${event.item.channel}/p${event.item.ts.replace('.', '')}`;
        }

        const today = getTodayJST();
        const notificationText = `【作業担当】<@${OKUBO_USER_ID}>\n${originalMessage.text}\n${messageLink}`;

        // 当日の親メッセージを検索
        const parentTS = await findTodayParentTS();

        if (parentTS) {
          // 既存スレッドに追記
          await slackClient.chat.postMessage({
            channel: NOTIFICATION_CHANNEL_ID,
            text: notificationText,
            thread_ts: parentTS,
            unfurl_links: false,
            unfurl_media: false
          });
        } else {
          // 当日初回：新規投稿（日付をテキストに埋め込む）
          await slackClient.chat.postMessage({
            channel: NOTIFICATION_CHANNEL_ID,
            text: `【作業担当】<@${OKUBO_USER_ID}> ${today}\n${originalMessage.text}\n${messageLink}`,
            unfurl_links: false,
            unfurl_media: false
          });
        }

        console.log('通知送信完了');
      } catch (error) {
        console.error('エラー:', error);
      }
    }
  }
});

// ヘルスチェック
app.get('/', (req, res) => {
  res.send('Slack Reaction Notifier is running');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
