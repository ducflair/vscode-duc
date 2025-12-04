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
      "publish": true,
      "packagePath": "./"
    }],
    ["@semantic-release/exec", {
      "prepareCmd": "npx ovsx publish duc-${nextRelease.version}.vsix --pat ${OVSX_PAT}"
    }],
    ["@semantic-release/github", {
      assets: [
        {
          path: "duc-*.vsix",
          label: "VS Code Extension"
        }
      ]
    }]
  ]
};