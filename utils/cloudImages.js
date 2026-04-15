function isCloudFileId(value) {
  return typeof value === "string" && value.indexOf("cloud://") === 0;
}

function getTempUrlMap(fileIds) {
  const unique = [
    ...new Set((fileIds || []).filter(isCloudFileId)),
  ];

  if (!unique.length) {
    return Promise.resolve({});
  }

  return wx.cloud
    .getTempFileURL({
      fileList: unique.map((fileID) => ({
        fileID,
        maxAge: 86400,
      })),
    })
    .then((res) => {
      const map = {};
      (res.fileList || []).forEach((item) => {
        if (item.status === 0 && item.tempFileURL) {
          map[item.fileID] = item.tempFileURL;
        }
      });
      return map;
    })
    .catch(() => ({}));
}

function withProofDisplayUrl(item, urlMap) {
  if (!item || !item.deliveryProof || !item.deliveryProof.fileID) {
    return item;
  }

  const fid = item.deliveryProof.fileID;
  const displayUrl = urlMap[fid];
  if (!displayUrl) {
    return item;
  }

  return Object.assign({}, item, {
    deliveryProof: Object.assign({}, item.deliveryProof, {
      displayUrl,
    }),
  });
}

function resolveOrderListCloudImages(list) {
  const ids = [];
  (list || []).forEach((item) => {
    const fid = item && item.deliveryProof && item.deliveryProof.fileID;
    if (fid) {
      ids.push(fid);
    }
  });

  return getTempUrlMap(ids).then((urlMap) =>
    (list || []).map((item) => withProofDisplayUrl(item, urlMap)),
  );
}

function resolveTaskCloudImages(task) {
  if (!task) {
    return Promise.resolve(task);
  }

  const ids = [];
  if (task.deliveryProof && task.deliveryProof.fileID) {
    ids.push(task.deliveryProof.fileID);
  }
  (task.attachments || []).forEach((a) => {
    if (a && a.filePath) {
      ids.push(a.filePath);
    }
  });

  return getTempUrlMap(ids).then((urlMap) => {
    let next = Object.assign({}, task);

    if (task.deliveryProof && task.deliveryProof.fileID) {
      const u = urlMap[task.deliveryProof.fileID];
      if (u) {
        next.deliveryProof = Object.assign({}, task.deliveryProof, {
          displayUrl: u,
        });
      }
    }

    if (Array.isArray(task.attachments)) {
      next.attachments = task.attachments.map((a) => {
        const fp = a && a.filePath;
        const u = fp && urlMap[fp];
        return u ? Object.assign({}, a, { displayUrl: u }) : a;
      });
    }

    return next;
  });
}

module.exports = {
  isCloudFileId,
  getTempUrlMap,
  resolveOrderListCloudImages,
  resolveTaskCloudImages,
};
