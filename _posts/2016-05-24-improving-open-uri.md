---
title: Improving open-uri
tags: ruby download
---

When working on the [Shrine] library for handling file uploads, in multiple
places I needed to be able to download a file from URL. If you know the Ruby
standard library well, the solution might be obvious to you: [open-uri].

```ruby
require "open-uri"
result = open("http://example.com/image.jpg")
result #=> #<Tempfile:/var/folders/k7/6zx6dx6x7ys3rv3srh0nyfj00000gn/T/20160524-10403-xpdakz>
```

Open-uri is something that I indeed very much wanted to use for my use case. It
ships with Ruby, so there are no external dependencies (just [Net::HTTP]), and
it has many benefits:

* downloads to a unique filesystem location (using Tempfile)
* supports HTTP/HTTPS/FTP links
* follows redirects
* memory efficient
* easy basic authentication
* easy proxy

However, also considering that in my case the URL could come from user input,
open-uri turned out to have many limiations and quirks:

* Using `Kernel#open` [makes you vulnerable to remote code execution]
* If the remote file is smaller than 10KB, open-uri actually returns a StringIO instead of a Tempfile
* URL's file extension isn't preserved in downloaded Tempfile
* You cannot limit maximum number of redirects
* You cannot limit maximum filesize

I've thought about alternatives: [rest-client], `curl` or `wget`. However,
rest-client was a too heavy dependency just for downloading, and I didn't want
to depend on external CLI tools. Also, none of them were able to properly limit
the maximum filesize, which I found important in context of Shrine.

So, realizing that I still wanted to use open-uri, I decided to make a wrapper
around it that addresses these limitations. I want to guide you through my
journey, fixing one issue at a time.

## Improvements

<h3 style="text-transform: none;">Kernel#open</h3>

Ruby has a `Kernel#open` method, which given a file path acts as `File.open`.
but given a string that starts with "|", it interprets it as a shell command
and returns an IO connected to the spawned subprocess:

```ruby
open("| ls") # returns an IO connected to the `ls` shell command
```

Open-uri extends `Kernel#open` with the ability to accept URLs. However, if the
URL is coming from user input, we should never pass it to `Kernel#open`,
because different users have different ideas on what is a "URL"; someone might
think that `| rm -rf ~` is a nice looking URL.

A little known fact is that `Kernel#open` just delegates to
`URI::(HTTP|HTTPS|FTP)#open`, and we can simply use that instead:

```ruby
uri = URI.parse("http://example.com/image.jpg") #=> #<URI::HTTP>
uri.open #=> #<Tempfile:/var/folders/k7/6zx6dx6x7ys3rv3srh0nyfj00000gn/T/20160524-10403-xpdakz>
```

<h3 style="text-transform: none;">StringIO</h3>

Stangely, if the remote file has less than 10KB, open-uri will actually return
a StringIO instead of a Tempfile.

```ruby
uri.open #=> #<StringIO>
```

In context of [Shrine] I wanted the returned IO to *always* be a file, for
consistency and because it could later be given for processing. We can easily
fix that:

```ruby
io = uri.open

if io.is_a?(StringIO)
  downloaded = Tempfile.new
  File.write(downloaded.path, io.string)
else
  downloaded = io
end

downloaded # now always a Tempfile
```

<h3 style="text-transform: none;">File extension</h3>

Surprisingly, open-uri always creates a Tempfile without a file extension,
even if the url has one. In Shrine I wanted that downloaded files (which will
later be uploaded) always have an extension if it's known.

So let's copy the downloaded IO to a new Tempfile which has a file extension,
but use `mv` if we can so that we don't pay any performance penalty (and that
the old file also gets deleted):

```ruby
io = uri.open
downloaded = Tempfile.new([File.basename(uri.path), File.extname(uri.path)])

if io.is_a?(Tempfile)
  FileUtils.mv io.path, downloaded.path
else # StringIO
  File.write(downloaded.path, io.string)
end

File.extname(downloaded.path) #=> ".jpg"
```

<h3 style="text-transform: none;">Redirects</h3>

What's good is that open-uri can automatically follow redirects. What's bad is
that we cannot limit the maximum number of redirects. This allows the attacker
to give a URL which causes a redirect loop, and open-uri would continue making
requests forever. To be fair, open-uri has a detection for redirect loops, but
only if URLs repeat.

So we disable open-uri's following of redirects, which now raises
`OpenURI::HTTPRedirect` on redirects, allowing us to reimplement it:

```ruby
tries = 3

begin
  uri.open(redirect: false)
rescue OpenURI::HTTPRedirect => redirect
  uri = redirect.uri # assigned from the "Location" response header
  retry if (tries -= 1) > 0
  raise
end
```

<h3 style="text-transform: none;">Maximum filesize</h3>

Since the URL can sometimes come from the user input, I wanted to give Shrine
users the ability to limit maximum filesize of the remote file. Specifically, I
wanted that download aborts as soon as the "Content-Length" header reveals that
the file will be too large. Luckily, open-uri has the `:content_length_proc`
option, which calls the given proc as soon as open-uri reads "Content-Length":

```ruby
uri.open(
  content_length_proc: ->(size) { raise FileTooLarge if size > max_size },
)
```

However, an attacker could theoretically create an app which returns large
files, but where the "Content-Length" response header is ommited on purpose.
Luckily, open-uri has got our back on this one too with `:progress_proc`, which
calls the given proc whenever a chunk is downloaded, with the current size.
That means we can add it as a fallback in case "Content-Length" is missing:

```ruby
uri.open(
  content_length_proc: ->(size) { raise FileTooLarge if size && size > max_size },
  progress_proc:       ->(size) { raise FileTooLarge if size > max_size },
)
```

<h3 style="text-transform: none;">User agent</h3>

It turns out that when we're making requests to an application, but we don't
include a "User-Agent" header, most applications will start rejecting our
requests after some time.

Open-uri doesn't include a "User-Agent" by default, but allows us to easily add
one, since open-uri treats any unknown option as a request header:

```ruby
uri.open("User-Agent" => "MyApp/1.0")
```

## Result

The result of this investigation is the [Down] gem, which incorporates all of
these improvements, and more. You can use it like this:

```ruby
require "down"
result = Down.download("http://example.com/image.jpg")
result #=> #<Tempfile:/var/folders/k7/6zx6dx6x7ys3rv3srh0nyfj00000gn/T/20160524-10403-xpdakz.jpg>
```

More advanced downloading could look something like this:

```ruby
Down.download "http://example.com/image.jpg",
  max_size: 20*1024*1024,   # 20 MB
  max_redirects: 5,         # default is 2
  proxy: "http://proxy.com" # delegates to open-uri
```

## Conclusion

I like that I was able to make a lightweight wrapper around open-uri, which
already had most of the features that I wanted, but allowed me to complete the
ones that I was missing. If you want to use open-uri, but without any of the
mentioned quirks, consider using [Down].

[Shrine]: https://github.com/janko-m/shrine
[open-uri]: http://ruby-doc.org/stdlib-2.2.0/libdoc/open-uri/rdoc/OpenURI.html
[Net::HTTP]: http://ruby-doc.org/stdlib-2.3.1/libdoc/net/http/rdoc/Net/HTTP.html
[makes you vulnerable to remote code execution]: http://sakurity.com/blog/2015/02/28/openuri.html
[Down]: https://github.com/janko-m/down
[rest-client]: https://github.com/rest-client/rest-client
