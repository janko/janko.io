---
title: Developing with History API and Deploying to S3
author: matija
tags: html5 history connect amazon s3
---

Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

## Set Up Amazon S3

Both Index Document and Error Document should be set to `index.html`. This way if you go to a URL which doesn't exist, S3 will display `index.html`, leaving the URL intact, which your router will use to display the correct page.
