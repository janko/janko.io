---
layout: post
title: Developing with History API and Deploying to S3
author: matija
tags: html5 history connect amazon s3
---

## Set Up Amazon S3

Both Index Document and Error Document should be set to `index.html`. This way if you go to a URL which doesn't exist, S3 will display `index.html`, leaving the URL intact, which your router will use to display the correct page.
