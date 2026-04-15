const STATUS_MAP = {
  pending: '待接单',
  accepted: '待完成',
  completed: '已完成',
  cancelled: '已取消'
};

const TYPE_MAP = {
  takeout: '外卖',
  parcel: '快递'
};

function padNumber(value) {
  return value < 10 ? '0' + value : '' + value;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    padNumber(date.getMonth() + 1),
    padNumber(date.getDate())
  ].join('-') + ' ' + [
    padNumber(date.getHours()),
    padNumber(date.getMinutes())
  ].join(':');
}

function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return '刚刚';
  }

  if (diff < hour) {
    return Math.floor(diff / minute) + ' 分钟前';
  }

  if (diff < day) {
    return Math.floor(diff / hour) + ' 小时前';
  }

  if (diff < 7 * day) {
    return Math.floor(diff / day) + ' 天前';
  }

  return formatTime(timestamp);
}

function formatCurrency(amount) {
  const value = Number(amount || 0);
  return '￥' + value.toFixed(2);
}

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function getAvatarText(name) {
  if (!name) {
    return '我';
  }

  return String(name).trim().slice(0, 1);
}

module.exports = {
  STATUS_MAP,
  TYPE_MAP,
  padNumber,
  formatTime,
  formatRelativeTime,
  formatCurrency,
  clone,
  getAvatarText
};
