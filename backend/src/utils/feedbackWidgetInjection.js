/**
 * Returns the HTML snippet to inject into build index.html for the feedback widget.
 * @param {string} apiUrl - Backend base URL (e.g. https://api.example.com or http://localhost:5000)
 * @param {string|number} projectId - Project/release identifier for feedback
 * @returns {string} HTML to inject before </head>
 */
export function getFeedbackWidgetScript(apiUrl, projectId) {
    const base = (apiUrl || "http://localhost:5000").replace(/\/$/, "");
    const projectIdStr = String(projectId ?? "");
    return `<script src="${base}/static/feedback-widget.min.js"><\/script>
  <script>
  (function(){
    var u="${base}";
    var p="${projectIdStr.replace(/"/g, '\\"')}";
    function run(){if(typeof FeedbackWidget!=="undefined")FeedbackWidget.init({projectId:p,apiUrl:u});}
    if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",run);}else{run();}
  })();
  <\/script>`;
  }