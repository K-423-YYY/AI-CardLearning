(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LocalPdf = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  async function extractText(arrayBuffer) {
    if (!window.pdfjsLib) {
      throw new Error('PDF 解析组件未加载，请刷新页面重试');
    }
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => (item && item.str ? item.str : ''))
        .join(' ');
      pages.push(text);
    }
    return pages.join('\n');
  }

  return { extractText };
});
