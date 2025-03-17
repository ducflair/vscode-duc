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
    ["semantic-release-vsce", {
      "packageVsix": true,
      "publish": true
    }],
    ["@semantic-release/github", {
      assets: [
        {
          path: ({ nextRelease }) => `duc-${nextRelease.version}.vsix`,
          label: "VS Code Extension"
        }
      ]
    }]
  ]
};