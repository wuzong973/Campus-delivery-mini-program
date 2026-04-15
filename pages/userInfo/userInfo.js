const api = require('../../utils/api');

function getDefaultDescription() {
  return '设置一句个性签名，让其他同学更快认识你。';
}

Page({
  data: {
    loading: true,
    saving: false,
    themes: getApp().globalData.avatarThemes,
    avatarText: '我',
    previewName: '请输入昵称',
    previewDesc: getDefaultDescription(),
    form: {
      nickname: '',
      phone: '',
      commonAddress: '',
      slogan: '',
      avatarTheme: 'ocean'
    }
  },

  onLoad() {
    this.loadProfile();
  },

  loadProfile() {
    wx.showLoading({ title: '加载中' });

    api.getCurrentUserProfile().then(profile => {
      this.setData({
        loading: false,
        avatarText: profile.avatarText || '我',
        previewName: profile.nickname || '请输入昵称',
        previewDesc: profile.slogan || getDefaultDescription(),
        form: {
          nickname: profile.nickname || '',
          phone: profile.phone || '',
          commonAddress: profile.commonAddress || '',
          slogan: profile.slogan || '',
          avatarTheme: profile.avatarTheme || 'ocean'
        }
      });
    }).catch(error => {
      wx.showToast({
        title: error.message || '加载失败',
        icon: 'none'
      });
    }).finally(() => {
      wx.hideLoading();
    });
  },

  handleInput(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    const nextData = {};
    nextData['form.' + field] = value;

    if (field === 'nickname') {
      nextData.avatarText = value ? value.slice(0, 1) : '我';
      nextData.previewName = value || '请输入昵称';
    }

    if (field === 'slogan') {
      nextData.previewDesc = value || getDefaultDescription();
    }

    this.setData(nextData);
  },

  chooseCommonAddress() {
    wx.chooseLocation({
      success: result => {
        const addressText = result.name ? (result.name + ' ' + result.address) : result.address;
        this.setData({
          'form.commonAddress': (addressText || '').trim()
        });
      },
      fail: error => {
        if (error.errMsg && error.errMsg.indexOf('cancel') !== -1) {
          return;
        }

        wx.showToast({
          title: '地图选点失败，请检查定位权限',
          icon: 'none'
        });
      }
    });
  },

  selectTheme(event) {
    this.setData({
      'form.avatarTheme': event.currentTarget.dataset.value
    });
  },

  validateForm() {
    const form = this.data.form;

    if (!form.nickname.trim()) {
      return '请输入昵称';
    }

    if (!/^1\d{10}$/.test(form.phone.trim())) {
      return '请输入正确的手机号';
    }

    if (!form.commonAddress.trim()) {
      return '请输入常用地址';
    }

    return '';
  },

  handleSubmit() {
    const message = this.validateForm();

    if (message) {
      wx.showToast({
        title: message,
        icon: 'none'
      });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中' });

    api.updateUserProfile(this.data.form).then(() => {
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 500);
    }).catch(error => {
      wx.showToast({
        title: error.message || '保存失败',
        icon: 'none'
      });
    }).finally(() => {
      this.setData({ saving: false });
      wx.hideLoading();
    });
  }
});
