const api = require("../../../utils/api");

const POLL_INTERVAL_MS = 4000;
// 连续失败时的退避上限，避免断网状态下持续高频请求
const POLL_MAX_INTERVAL_MS = 60000;
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

  // 分享给好友：携带会话信息，打开后可直接进入同一会话
  onShareAppMessage() {
    const sessionId = this.data.sessionId || "";
    const targetUserName = this.data.targetUserName || "";
    return {
      title: targetUserName
        ? `校园代拿 - 与 ${targetUserName} 的聊天`
        : "校园代拿 - 校园跑腿互助平台",
      path: sessionId
        ? `/pages/chat/detail/detail?sessionId=${sessionId}`
        : "/pages/index/index",
      imageUrl: ""
    };
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
    this.polling = true;
    this.pollFailures = 0;
    this.scheduleNextPoll(POLL_INTERVAL_MS);
  },

  stopPolling() {
    this.polling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  },

  // 自调度 setTimeout + 指数退避：断网时不会持续每 4 秒打一次接口
  scheduleNextPoll(delay) {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }

    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;

      if (!this.polling || !this.data.sessionId) {
        if (this.polling) {
          this.scheduleNextPoll(POLL_INTERVAL_MS);
        }
        return;
      }

      this.loadMessages(false, true).then((ok) => {
        if (!this.polling) {
          return;
        }

        this.pollFailures = ok ? 0 : (this.pollFailures || 0) + 1;

        const next = Math.min(
          POLL_INTERVAL_MS * Math.pow(2, Math.min(this.pollFailures, 4)),
          POLL_MAX_INTERVAL_MS,
        );

        this.scheduleNextPoll(next);
      });
    }, delay);
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
        // 静默加载：外层 openSession 的 catch 已经负责错误提示，避免重复弹窗
        return this.loadMessages(false, true);
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

  /**
   * 拉取消息列表。
   * @param {boolean} showLoading 是否显示全屏 loading
   * @param {boolean} silent 静默模式：失败不弹 toast（轮询必须用）
   * @returns {Promise<boolean>} 是否成功，供轮询退避判断
   */
  loadMessages(showLoading, silent) {
    if (!this.data.sessionId) {
      wx.stopPullDownRefresh();
      return Promise.resolve(true);
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
        return true;
      })
      .catch((error) => {
        this.setData({
          loading: false,
        });

        if (!silent) {
          wx.showToast({
            title: (error && error.message) || "加载消息失败",
            icon: "none",
          });
        } else {
          console.warn("load chat messages failed", error);
        }

        return false;
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
          .catch((error) => {
            // 旧实现只有 then + finally，上传失败会产生未捕获的 Promise rejection，
            // 用户只看到 loading 消失、没有任何提示。
            wx.showToast({
              title: (error && error.message) || "图片发送失败，请重试",
              icon: "none",
            });
          })
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
