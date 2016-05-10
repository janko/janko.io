---
layout: post
title: My backpack is Ruby
author: janko
tags: ruby rails frameworks railsconf
---

At the recent RailsConf DHH talked about why he thinks Rails is moving in the
right direction. He asked us to imagine an apocalyptic scenario where we are
left alone as solo-developers and have to figure out a way to ship our app.
In that case we need a tool that will fit in our backpack, which allows us
to build a whole application, and that tool is Rails. (TODO: Listen to that part again)

Now, I cannot find any real situation which would fit the description of DHH's
"apocalypse". Instead, I would like you to imagine a different type of
"apocalypse", which is more likely to happen. Imagine that you're in a
project where you **cannot**/**shouldn't** use Rails. This can happen for various
reasons:

1. You came to an already existing non-Rails project (e.g. Travis)
2. You want to switch to another web framework for convenience
  * when building APIs, a lot of companies find
    [Sinatra](https://github.com/sinatra/sinatra) or
    [Grape](https://github.com/intridea/grape) a much better fit
3. You need to switch to another web framework for performance
  * sometimes your API needs to be really fast, in which case you may need to
    switch to an Eventmachine-based framework like
    [Goliath](https://github.com/postrank-labs/goliath)

[You never know](TOOD: RailsConf link) what will be the requirements for your
application, so it's better to be prepared for the apocalypse. I agree that
these situations don't happen very often, but that's because most applications
aren't successful. I'm only interested in popular applications (or ones which
have great potential to become popular), which likely need to scale in both
performance and code design.

My main message is, it's good to decouple yourself from your web framework
(Rails), because it provides you maximum flexibility.

## Frontend

In my [previous post](http://twin.github.io/lets-keep-frontend-outside-of-ruby)
I talked about why we should keep frontend outside of our Ruby web frameworks,
and only build APIs that JavaScript and mobile applications will consume.
Everyone says that you can get up running very quickly with Rails.

If I'm in a startup, I want to build the application in 

## Rails-specific gems

* switching frameworks / building new apps in another framework
* What if prototyping is as fast in backend+frontend as it is in Rails (but you
  don't have to pay technical debt)
* smaller team, shortest duration je obrnuto proporcionalno
* Spomeni Rodu i Sequel
* Trailblazer i ActiveModel::Serializers su primjeri Rails-specific gemova
* Keep Rails layer thin (down with Rails-specific gems)
* You shouldn't keep your frontend in Rails (mention the RailsConf talk about specific-case)
* GitHub koristi Sinatru
