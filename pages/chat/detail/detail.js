const api = require("../../../utils/api");

const POLL_INTERVAL_MS = 4000;
const SHOW_TIME_GAP_MS = 5 * 60 * 1000;
const EMOJI_LIST = [
  "😀",
  "😁",
  "😂",
  "🤣",
  "😊",
  "😍",
  "😘",
  "🥹",
  "😎",
  "🤔",
  "😭",
  "😡",
  "👍",
  "👏",
  "🙏",
  "🎉",
  "❤️",
  "💪",
];

Page({
  data: {
    loading: true,
    sessionId: "",
    orderId: "",
    targetUserId: "",
    targetUserName: "",
    session: null,
    messages: [],
    inputValue: "",
    scrollToView: "",
    showEmojiPanel: false,
    sending: false,
    uploadingImage: false,
    emojiList: EMOJI_LIST,
  },

  onLoad(options) {
    this.setData({
      sessionId: options.sessionId || "",
      orderId: options.orderId || "",
      targetUserId: options.targetUserId || "",
      targetUserName: decodeURIComponent(options.targetUserName || ""),
    });

    if (this.data.targetUserName) {
      this.updateTitle(this.data.targetUserName);
    }

    if (this.data.sessionId) {
      this.loadMessages(true);
      return;
    }

    this.openSession();
  },

  onShow() {
    this.startPolling();
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
  },

  onPullDownRefresh() {
    this.loadMessages(false);
  },

  updateTitle(title) {
    wx.setNavigationBarTitle({
      title: title || "聊天",
    });
  },

  startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      if (this.data.sessionId) {
        this.loadMessages(false);
      }
    }, POLL_INTERVAL_MS);
  },

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  },

  decorateMessages(messages) {
    return (messages || []).map((item, index, list) => {
      const previous = list[index - 1];
      const showTime =
        !previous ||
        Math.abs(
          Number(item.createdAt || 0) - Number(previous.createdAt || 0),
        ) > SHOW_TIME_GAP_MS;

      return Object.assign({}, item, {
        showTime,
      });
    });
  },

  scrollToBottom() {
    const lastItem = this.data.messages[this.data.messages.length - 1];
    if (!lastItem) {
      return;
    }
    this.setData({
      scrollToView: `msg-${lastItem.id}`,
    });
  },

  emitChatUpdated() {
    getApp().eventBus.emit("chatUpdated");
  },

  openSession() {
    if (!this.data.orderId || !this.data.targetUserId) {
      wx.showToast({
        title: "缺少聊天参数",
        icon: "none",
      });
      return;
    }

    wx.showLoading({ title: "进入聊天中", mask: true });
    api
      .openChatSession({
        orderId: this.data.orderId,
        targetUserId: this.data.targetUserId,
      })
      .then((session) => {
        this.setData({
          sessionId: session.sessionId,
          session,
        });
        this.updateTitle(
          (session.targetUser && session.targetUser.nickname) ||
            this.data.targetUserName,
        );
        this.emitChatUpdated();
        return this.loadMessages(false);
      })
      .catch((error) => {
        this.setData({
          loading: false,
        });
        wx.showToast({
          title: error.message || "进入聊天失败",
          icon: "none",
        });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },

  loadMessages(showLoading) {
    if (!this.data.sessionId) {
      wx.stopPullDownRefresh();
      return Promise.resolve();
    }

    if (showLoading) {
      wx.showLoading({ title: "加载中", mask: true });
    }

    return api
      .getChatMessages(this.data.sessionId)
      .then((data) => {
        const messages = this.decorateMessages(data.messages || []);
        this.setData(
          {
            loading: false,
            orderId:
              (data.session && data.session.orderId) || this.data.orderId,
            session: data.session || this.data.session,
            messages,
          },
          () => {
            this.updateTitle(
              (data.session &&
                data.session.targetUser &&
                data.session.targetUser.nickname) ||
                this.data.targetUserName,
            );
            this.scrollToBottom();
          },
        );
        this.emitChatUpdated();
      })
      .catch((error) => {
        this.setData({
          loading: false,
        });
        wx.showToast({
          title: error.message || "加载消息失败",
          icon: "none",
        });
      })
      .finally(() => {
        if (showLoading) {
          wx.hideLoading();
        }
        wx.stopPullDownRefresh();
      });
  },

  onInput(event) {
    this.setData({
      inputValue: event.detail.value,
    });
  },

  toggleEmojiPanel() {
    this.setData({
      showEmojiPanel: !this.data.showEmojiPanel,
    });
  },

  sendPayload(payload, options) {
    if (!this.data.sessionId || this.data.sending) {
      return Promise.resolve();
    }

    const nextOptions = Object.assign(
      {
        clearInput: false,
      },
      options || {},
    );

    this.setData({
      sending: true,
      showEmojiPanel: false,
      inputValue: nextOptions.clearInput ? "" : this.data.inputValue,
    });

    return api
      .sendChatMessage(this.data.sessionId, payload)
      .then((result) => {
        const messages = this.decorateMessages([
          ...this.data.messages,
          result.message,
        ]);
        this.setData(
          {
            session: result.session || this.data.session,
            messages,
          },
          () => {
            this.scrollToBottom();
          },
        );
        this.emitChatUpdated();
      })
      .catch((error) => {
        if (nextOptions.clearInput) {
          this.setData({
            inputValue: payload.content || "",
          });
        }
        wx.showToast({
          title: error.message || "发送失败",
          icon: "none",
        });
      })
      .finally(() => {
        this.setData({
          sending: false,
        });
      });
  },

  sendText() {
    const content = String(this.data.inputValue || "").trim();
    if (!content) {
      return;
    }

    this.sendPayload(
      {
        type: "text",
        content,
      },
      {
        clearInput: true,
      },
    );
  },

  chooseImage() {
    if (this.data.uploadingImage) {
      return;
    }

    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (result) => {
        const tempFile =
          result && result.tempFiles && result.tempFiles.length
            ? result.tempFiles[0]
            : null;

        if (!tempFile || !tempFile.tempFilePath) {
          return;
        }

        this.setData({
          uploadingImage: true,
          showEmojiPanel: false,
        });
        wx.showLoading({ title: "发送图片中", mask: true });

        api
          .uploadChatImage(tempFile.tempFilePath)
          .then((uploadResult) =>
            this.sendPayload({
              type: "image",
              content: uploadResult.url,
              imageUrl: uploadResult.url,
            }),
          )
          .finally(() => {
            wx.hideLoading();
            this.setData({
              uploadingImage: false,
            });
          });
      },
    });
  },

  sendEmoji(event) {
    const emoji = event.currentTarget.dataset.emoji;
    if (!emoji) {
      return;
    }

    this.sendPayload({
      type: "emoji",
      content: emoji,
    });
  },

  previewImage(event) {
    const current = event.currentTarget.dataset.src;
    const urls = this.data.messages
      .filter((item) => item.type === "image" && item.imageUrl)
      .map((item) => item.imageUrl);

    wx.previewImage({
      current,
      urls: urls.length ? urls : [current],
    });
  },

  openOrder() {
    if (
      !this.data.orderId &&
      !(this.data.session && this.data.session.orderId)
    ) {
      return;
    }

    wx.navigateTo({
      url: `/pages/taskDetail/taskDetail?id=${this.data.orderId || this.data.session.orderId}&from=chat`,
    });
  },
});
