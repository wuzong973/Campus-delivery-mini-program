const config = require("./config");

function isCloudFileId(value) {
  return typeof value === "string" && value.indexOf("cloud://") === 0;
}

function toDisplayUrl(value) {
  if (!value) {
    return "";
  }

  if (/^https?:\/\//.test(value) || isCloudFileId(value)) {
    return value;
  }

  return `${config.uploadBaseUrl}${value.startsWith("/") ? "" : "/"}${value}`;
}

function withProofDisplayUrl(item) {
  if (!item || !item.deliveryProof || !item.deliveryProof.fileID) {
    return item;
  }

  return Object.assign({}, item, {
    deliveryProof: Object.assign({}, item.deliveryProof, {
      displayUrl: toDisplayUrl(
        item.deliveryProof.displayUrl || item.deliveryProof.fileID,
      ),
    }),
  });
}

function resolveOrderListCloudImages(list) {
  return Promise.resolve(
    (list || []).map((item) => {
      const next = withProofDisplayUrl(item);
      if (!next || !Array.isArray(next.attachments)) {
        return next;
      }

      return Object.assign({}, next, {
        attachments: next.attachments.map((attachment) =>
          Object.assign({}, attachment, {
            displayUrl: toDisplayUrl(
              attachment.displayUrl || attachment.filePath || "",
            ),
            filePath: toDisplayUrl(attachment.filePath || ""),
          }),
        ),
      });
    }),
  );
}

function resolveTaskCloudImages(task) {
  if (!task) {
    return Promise.resolve(task);
  }

  const next = withProofDisplayUrl(task);
  return Promise.resolve(
    Object.assign({}, next, {
      attachments: Array.isArray(next.attachments)
        ? next.attachments.map((attachment) =>
            Object.assign({}, attachment, {
              displayUrl: toDisplayUrl(
                attachment.displayUrl || attachment.filePath || "",
              ),
              filePath: toDisplayUrl(attachment.filePath || ""),
            }),
          )
        : [],
    }),
  );
}

module.exports = {
  isCloudFileId,
  resolveOrderListCloudImages,
  resolveTaskCloudImages,
};
