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

// メイン処理
app.post('/slack/events', async (req, res) => {
  const body = JSON.parse(req.body.toString());
  
  // URL検証（初回設定時）
  if (body.type === 'url_verification') {
    return res.json({ challenge: body.challenge });
  }
  
  // 署名検証
  if (!verifySlackSignature(req)) {
    return res.status(401).send('Invalid signature');
  }
  
  // 3秒以内に応答
  res.status(200).send('OK');
  
  // リアクション追加イベント
  if (body.event && body.event.type === 'reaction_added') {
    const event = body.event;
    
    // 神原さんまたはテストユーザーが :okubo_taiou: をリアクションした場合のみ
    if ((event.user === KAMBARA_USER_ID || event.user === TEST_USER_ID) && event.reaction === TARGET_REACTION) {
      try {
        // 元メッセージの情報を取得（スレッド内対応）
        let originalMessage;
        
        if (event.item.type === 'message') {
          // まずhistoryで試みる
          const result = await slackClient.conversations.history({
            channel: event.item.channel,
            latest: event.item.ts,
            limit: 1,
            inclusive: true
          });
          originalMessage = result.messages[0];
        
          // スレッド内メッセージの場合（tsが一致しない場合はrepliesから取得）
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
        }
        
        // メッセージリンク作成（スレッド内メッセージ対応）
        let messageLink;
        if (originalMessage.thread_ts && originalMessage.thread_ts !== originalMessage.ts) {
          // スレッド内メッセージの場合
          messageLink = `https://slack.com/archives/${event.item.channel}/p${event.item.ts.replace('.', '')}?thread_ts=${originalMessage.thread_ts}&cid=${event.item.channel}`;
        } else {
          // 通常メッセージの場合
          messageLink = `https://slack.com/archives/${event.item.channel}/p${event.item.ts.replace('.', '')}`;
        }
        
        // 通知チャンネルに投稿
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

// ヘルスチェック
app.get('/', (req, res) => {
  res.send('Slack Reaction Notifier is running');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
