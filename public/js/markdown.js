// Small, dependency-free markdown-ish renderer covering the basics:
// headings, bold/italic, inline code, links, unordered/ordered lists, and
// paragraphs. Not a full CommonMark implementation — just enough for item
// notes. (Ported unchanged from the original vanilla-JS app.)

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

export function renderMarkdown(src) {
  var escaped = escapeHtml(src || '');
  var lines = escaped.split('\n');
  var htmlLines = [];
  var inUl = false;
  var inOl = false;

  function closeLists() {
    if (inUl) { htmlLines.push('</ul>'); inUl = false; }
    if (inOl) { htmlLines.push('</ol>'); inOl = false; }
  }

  function inline(text) {
    return text
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    var heading = line.match(/^(#{1,6})\s+(.*)$/);
    var ulItem = line.match(/^[-*]\s+(.*)$/);
    var olItem = line.match(/^\d+\.\s+(.*)$/);

    if (heading) {
      closeLists();
      var level = heading[1].length;
      htmlLines.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
    } else if (ulItem) {
      if (!inUl) { closeLists(); htmlLines.push('<ul>'); inUl = true; }
      htmlLines.push('<li>' + inline(ulItem[1]) + '</li>');
    } else if (olItem) {
      if (!inOl) { closeLists(); htmlLines.push('<ol>'); inOl = true; }
      htmlLines.push('<li>' + inline(olItem[1]) + '</li>');
    } else if (line === '') {
      closeLists();
    } else {
      closeLists();
      htmlLines.push('<p>' + inline(line) + '</p>');
    }
  }
  closeLists();
  return htmlLines.join('\n') || '<p class="hint">Nothing to preview yet.</p>';
}

export { escapeHtml };
