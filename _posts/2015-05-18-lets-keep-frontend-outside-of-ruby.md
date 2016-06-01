---
title: Let's keep frontend outside of Ruby
updated: 27.5.2015.
tags: ruby rails javascript frameworks
---

Rails started as an excellent full-stack web framework. It made web development
incredibly easy and fast, especially when the asset pipeline came along. However,
the JavaScript world has evolved significantly since then, and it is able to
take care of itself now.

I think it's time we hand over frontend to the Node.js ecosystem of build tools
and JavaScript frameworks, and use our Rails apps only for JSON API. What are
the advantages of this design?

## Ability to focus on the backend

We Ruby developers like to make fun of JavaScript, but the truth is, we simply
aren't good at writing it. That's because we're so busy with our backends,
since we have to know so many things:

* The Ruby language + code design
* Our web framework + the HTTP protocol
* Databases and ORMs (PostgreSQL, Elasticsearch, Redis)
* Background jobs
* Testing
* Performance
* Deployment

These are all huge fields, and very delicate. I really want to be good in all
these fields, and research and experiment which are the best tools for each
field (for example, I recently found out that
[Sequel](http://sequel.jeremyevans.net) is a lot better than ActiveRecord). So,
how in the earth will I find time for frontend as well? Can't someone else do
frontend instead of me, let's say a frontend person?

If you're a full-stack developer, you think that you can handle both very well,
but in most cases that's just not true, because there are too many things to know
in the backend world alone.

## Ability to hire actual frontend developers

Many job descriptions ask for full-stack developers, from which they require
vast knowledge in both backend and frontend. That's insane, it's impossible to
know both fields well, espcially since JavaScript world is developing so
rapidly. I have an idea, why not just hire 2 developers instead, each for one
part? They will cost the same in total, and the application will have actually
quality frontend. It's an enormous difference whether the frontend is written
by full-stack developer who "knows frontend" or an actual frontend person.

Ok, fair, buy why not still keep the frontend in Rails? Frontend developers
generally aren't familiar with Ruby and its ecosystem (why would they be, that
knowledge is useless to them once they switch to a project with a PHP backend),
so they will naturally **avoid Rails jobs**. That's really unfortunate, I don't
want just a frontend that "works", I want it to be awesome and well designed.
Frontend developers shouldn't have to care in which language/framework the
backend is written in.

The reason why JavaScript developers don't need Ruby ecosystem is because they
have their own awesome Node.js ecosystem. Node.js, along with being a backend,
has incredible frontend build tools written in it. They have
[Assetgraph](https://github.com/assetgraph/assetgraph-builder), which is their
alternative to Sprockets, and it's *much* more advanced and better designed
(see [features](https://github.com/assetgraph/assetgraph-builder#features)),
because of course it was written by frontend developers who really know best.

Frontend developers don't use regular ruby Sass anymore, because it compiles
too slowly for them as the project grows. Did you know that
[Libsass](https://github.com/sass/libsass) is an awesome C/C++ implementation of
Sass, which compiles **10x faster** than ruby Sass? Did you know that even Libsass
isn't the best way to write CSS?
[PostCSS](https://github.com/postcss/postcss) lets you write regular CSS, and
what it does is just corrects your CSS during compilation to be cross-browser.
Now, wait for it... PostCSS is **3x faster** than Libsass. So, PostCSS is both
the best way to write CSS *and* the fastest option.

Does Sprockets have support for Libsass or PostCSS? Of course not, we like our
ruby Sass, even though frontend developers aren't using it anymore. I hope you
have worked in a codebase with a bit more frontend code to know how compilation
time can grow fast, and how keeping it fast is essential for productivity
(analogous to how speed of our tests is essential to our productivity).

We just can't keep up with the JavaScript world and continue making
`sprockets-*` extensions for every new thing, it's much better to just use
the awesome Node.js tools directly.

## Better performance

Most Rails developers use Turbolinks to make their websites snappy, and
Turbolinks 3 will allow us to achieve an even better performance and UX.
It can now keep certain parts of the webpage still, and refresh the rest.
However, Turbolinks of course still renders the **whole** webpage in the
background, and only then replaces the parts that are needed. That means that
you don't get any performance benefit, because the backend still has to do the
same amount of work.

An alternative is to just use AJAX directly, with or without UJS. However,
that obviously doesn't scale, that's the whole reason why JS frameworks were
invented in the first place, to tame spaghetti AJAX calls into something
structured. So, for any non-trivial projects the only right choice is to use
something like React.js.

Another benefit of using a JavaScript framework is page caching. In JavaScript
frameworks you **don't have to do any page caching**, HTML pages are served
from a CDN (along with the assets), because HTML pages can now also be compiled
upfront. That means all "rendering" is done by JavaScript in place, which is
just really fast. In Rails we can only cache parts of our templates, because
it's usually impossible to properly cache whole web pages, because there are
so many things we have to handle (parts of the page that are specific to the
logged in user, CSRF tokens etc).

Sure, on server side you should still do HTTP caching of your JSON resources,
but that's now much simpler and more maintainable, because you can now cache
one type of resource in only one place. Your frontend may want to request
list of posts in different contexts, but if it always requests `/posts` you
only need to cache that action.

## Being frontend-agnostic

When our backend only provides JSON API, we are agnostic to the type of client
that is consuming it. Of course, we could expose a JSON API alongside the regular
HTML API, but that almost always introduces duplications, and it's harder to
manage.

JSON APIs provide extreme flexibility, because the company can now decide that
they want to have an iOS app alongside the web frontend, and they can just use
the same JSON API. Of course, building a flexible JSON APIs isn't an easy task
but the [JSON-API specification](http://jsonapi.org) aims to bring conventions
which makes this much easier, and it has almost reached version 1.0 and it's
already very usable with a great library ecosystem.

When you have a flexible JSON API, you don't need to care who consumes it; it
can be a web frontend, iOS/Android app, or a washing machine. Those clients all
need to speak only one common language: HTTP & JSON.

## Easy to make frontend-only prototypes

With frontend-backend separation it's easy to develop independently. Frontend
developers don't need to wait for the backend to implement the endpoint, they
can just write their part and use fixtures (all JS frameworks make this very
transparent to use), and then they can just swap from fixtures to a real
endpoint once it's done.

You can imagine that this makes prototyping very easy to do. Prototypes are
crucial for rapid web development, because they enable very fast iteration.

## Conclusion

I've worked a lot on full-stack Rails applications. And it just doesn't work
properly in the long run, because frontend is always done by Ruby developers,
and then code design and UI are suffering due to lack of knowledge. GitHub is
managing this very well, but you can't always count on exceptional developers.

Let's keep backend and frontend separate, because they really are two separate
fields. Let's optimize for quality and developer happiness.
