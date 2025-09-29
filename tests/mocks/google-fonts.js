const path = require("node:path");

const fontPath = (...segments) => path.join(__dirname, "fonts", ...segments);
const sharedFace = (family, variable) => `@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: 400;\n  font-display: swap;\n  src: url(${variable});\n}`;

module.exports = {
  "https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap": sharedFace(
    "Geist",
    fontPath("geist.woff2")
  ),
  "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&display=swap": sharedFace(
    "Geist Mono",
    fontPath("geist-mono.woff2")
  ),
};
