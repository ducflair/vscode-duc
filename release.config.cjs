module.exports = {
  branches: [
    "main",
    {
      name: "next",
      prerelease: true
    }
  ],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ["@semantic-release/exec", {
      "prepareCmd": "npx @vscode/vsce package -o duc-${nextRelease.version}.vsix",
      "publishCmd": "npx @vscode/vsce publish -p ${process.env.VSCE_PAT}"
    }],
    ["@semantic-release/github", {
      assets: [
        { path: "duc-*.vsix", label: "VS Code Extension" },
      ]
    }],
  ]
};
