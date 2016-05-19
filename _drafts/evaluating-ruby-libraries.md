---
layout: post
title: Evaluating (Ruby) Libraries
author: janko
tags: ruby gem
---

Whenever we need to solve a problem in our application, if this problem is
common enough, chances are there are already libraries out there which can help
us with that. Great, now we just pick the library with most GitHub stars, and
start integrating it into our project. So, the next thing—

Wait. Wait just a minute. It's great that there is a popular library for the
functionality that we need, but we should be careful with our choice. Once we
start hitting limitations of our chosen library, it's likely the library is
already deeply integrated into our codebase, making switching to another
library difficult.

We should take our time when choosing a library. It's good to make a list of
all active libraries which solve this same problem, and then evaluate them
using different criteria than just popularity. In this post I want to talk
about which criteria do I use when evaluating Ruby libraries, grouping them
into "more valuable" and "less valuable" categories.

## More valuable criteria

### Features

Most important, what can the library do.

### Generic

Not Rails-specific is a plus

### Codebase

Clean codebase

### Issues

How issues are handled, number of open issues & pull requests

### Releases

Is the release cycle more-or-less regular

## Less valuable criteria

### Familiarity

### Number of stars

### Part of Rails

### Rails integration

### Number of maintainers
