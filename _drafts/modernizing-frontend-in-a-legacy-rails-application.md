---
title: Modernizing Frontend in a Legacy Rails Application
---

At my [current company](https://butterflymx.com), our central admin interface is a 8+ year old Rails app. Initially frontend assets were managed by Sprockets, then Webpacker was added for newer JavaScript code, and soon after that we started using Stimulus as well.

Around this time I joined the company. We had older JavaScript spaghetti-style in Sprockets, newer JavaScript in Webpacker using Stimulus, and CSS (Sass) and images in Sprockets. We were using Bootstrap 3, jQuery, Rails UJS, Selectize, Font Awesome and similar libraries.

Webpacker had started falling out of fashion, with the rise of simpler integrations for Node bundlers (`jsbundling-rails`, `cssbundling-rails`), Node-free processors (`tailwindcss-rails`, `dartsass-rails`) as well as nobuild solutions (`importmap-rails`). However, I had [Vite Ruby](https://github.com/ElMassimo/vite_ruby) on my radar, which offered a single pipeline for both JS and CSS, with access to modern tooling while keeping backwards compatibility.

Before we could migrate to Vite, I knew we first had to finish the move from Sprockets to Webpacker, as I expected that going from Webpacker to Vite would be a much smoother transition.

### Sprockets to Webpacker Migration
