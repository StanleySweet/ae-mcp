# Installer resources

`electron-builder` copies everything in this directory into the app's
`Contents/Resources` (`extraResources`). The release workflow drops the packed
`ae-mcp.mcpb` here before building, so the Setup app ships with the extension it
hands to Claude Desktop.
