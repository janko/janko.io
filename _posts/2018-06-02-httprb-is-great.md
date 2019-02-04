---
title: Http.rb is Great
tags: ruby gem library http streaming design download upload
---

The Ruby ecosystem has many HTTP clients gems to choose from. Some are built on
[libcurl] ([Typhoeus], [Curb], [Patron]), some on Ruby's [Net::HTTP]
([RestClient], [HTTParty], [Nestful]), some in pure Ruby ([HTTPClient],
[Excon], [http.rb]), and some are wrappers around existing libraries
([Faraday], [HTTPI]).

<div class="media">
  <img alt="Taxonomy of Ruby HTTP client libraries" src="{{ site.baseurl }}/images/ruby-http-client-taxonomy.png" />
</div>

Over the years I've had the opportunity to try out most of these libraries, but
ever since I discovered **[http.rb]** a year ago, it's been my favourite
HTTP client library. So, in this post I would like to talk about the features
that make http.rb stand out for me.

## Net::HTTP

Before we start, I would like to say a few words about Net::HTTP. Net::HTTP is
the HTTP client that comes with the Ruby standard library, and it's used in
many places. People often reach for it when they want something simple, or they
use it indirectly through gems like RestClient and HTTParty.

However, whenever I used Net::HTTP, I always had a bad time. Some of the reasons
were

* inconsistent and overly verbose API that's tough to remember
* poorly designed internals making the code difficult to read
* having to handle low-level system call exceptions

To illustrate, in my previous job we used Net::HTTP for notifying webhooks, and
this is the code that we ended up with:

```rb
def post_payload(callback_url, payload)
  uri = URI.parse(callback_url)

  options = { open_timeout: 15, read_timeout: 30 }
  options.merge!(use_ssl: true) if uri.scheme == "https"

  Net::HTTP.start(uri.host, uri.port, options) do |http|
    post = Net::HTTP::Post.new(uri.request_uri)
    post.body = JSON.dump(payload)
    post["Content-Type"] = "application/json"

    http.request(post)
  end
rescue SocketError,
       EOFError,
       IOError,
       SystemCallError, # superclass for all Errno::* exceptions
       Timeout::Error, # superclass for Net::ReadTimeout and Net::OpenTimeout
       Net::HTTPBadResponse,
       Net::HTTPHeaderSyntaxError,
       Net::ProtocolError,
       OpenSSL::SSL::SSLError
  # handle exception
end
```

The wish to make performing tasks like these easier was probably what motivated
people to build HTTP client gems on top of Net::HTTP (RestClient, HTTParty,
Nestful etc). They wanted to improve the API, but didn't want to reimplement
the HTTP protocol. However, I found the Net::HTTP codebase to be very
convoluted, and always felt frustrated whenever I needed to read it. So, I
don't think that building on top of Net::HTTP is a good design decision,
because Net::HTTP is not a clean implementation of the HTTP protocol to begin
with.

When creating http.rb, Tony Arcieri decided to rebuild the HTTP protocol
natively in Ruby (and also created the [Socketry] gem to make working with
TCP/UDP sockets easier). This allowed http.rb to have a fresh start, without
the Net::HTTP baggage.

> http.rb was born out of rage from using Net::HTTP
>
> — Tony Arcieri, creator of http.rb

## Refreshing API

One of the important goals of http.rb was to make the API easy to use. Let's
rewrite the previous Net::HTTP example of POSTing a JSON payload to an URL,
this time using http.rb.

```rb
def post_payload(callback_url, payload)
  http = HTTP.timeout(connect: 15, read: 30)
  http.post(callback_url, json: payload)
rescue HTTP::Error
  # handle exception
end
```

*Much* easier! Unlike Net::HTTP, http.rb wraps all low-level exceptions into a
nice exception hierarchy that's easy to handle:

* `HTTP::Error`
  - `HTTP::ConnectionError`
  - `HTTP::RequestError`
  - `HTTP::ResponseError`
  - `HTTP::TimeoutError`
  - `HTTP::HeaderError`

Here is a more comprehensive example of interaction with http.rb objects:

```rb
response = HTTP.get("https://example.com")
response # => #<HTTP::Response/1.1 200 OK ...>

response.status          # => #<HTTP::Response::Status 200 OK>
response.status.code     # => 200
response.status.ok?      # => true (200)
response.status.success? # => true (200..299)

response.headers         # => #<HTTP::Headers {…}>
response.headers.to_h    # => { "Content-Type"=>"text/html", ... }

response.body            # => #<HTTP::Response::Body>
response.body.to_s       # => "<!doctype html>..."
```

Where http.rb really shines is its chainable API for building request options.
You can use it to build an HTTP client with default request options, and then
make subsequent requests with it.

```rb
# Build an HTTP::Client with default request options
http = HTTP
  .headers("User-Agent" => "MyApp/1.0.0")
  .accept(:json)
  .basic_auth(user: "janko", pass: "secret")
  .via("https://proxy.com")
  .follow(max_hops: 2)

http.get("https://blog.com/posts")
http.get("https://blog/com/posts/1")
http.get("https://blog/com/posts/1/comments")
```

## Streaming

One of the features of http.rb that I like very much is the support for
streaming requests and responses. This is really useful when you need to
transfer large amounts of data over-the-wire which you don't want to load into
memory all at once (think uploading and downloading large files).

### Uploads

There are two ways you can stream content into the request body with http.rb.
One is providing an [Enumerable] object, where you can have `#each` lazily
generate chunks of content for the request body. The easiest way is to create
an [Enumerator] object.

Another way is providing an [IO]-like object that implements [`IO#read`]. In
this case http.rb will read the IO content in small chunks and write them to
the request body. Notice that the object doesn't have to be an actual `File`
instance, which is very convenient in contexts such as [Shrine], where the
"file" to be uploaded can be a `File`, `Tempfile`, `StringIO`,
`ActionDispatch::Http::UploadedFile`, [`Shrine::UploadedFile`],
[`Down::ChunkedIO`], or any other object that implements `IO#read`.

```rb
HTTP.put("http://example.com/upload", body: io) # streaming upload
```

#### Multipart Form Data

Http.rb will stream request bodies in [multipart form data] format as well:

```rb
HTTP.post("http://example.com/upload", form: { file: HTTP::FormData::File.new(io) })
```

It uses the [http-form_data] gem to create a `HTTP::FormData::Multipart`
object, which implements `IO#read` an generates multipart form data body
on-the-fly, so streaming works on the same principle as above. The
implementation of the streaming functionality in `http-form_data` was inspired
by the [`multipart-post`] gem.

Even though the `multipart-post` gem exists, and [Net::HTTP itself has
multipart form data functionality][Net::HTTP multipart form data],
[RestClient][RestClient multipart] and [HTTParty][HTTParty multipart] still
decided to implement their own. RestClient writes the multipart form data body
to disk before sending it (Net::HTTP does this as well), while RestClient loads
the whole body into memory. When uploading large files, both of these approaches
require resource planning, so that you don't risk running out of disk/memory.

The advantage of http.rb's streaming approach is that resource usage doesn't
grow with the size of the request body, so it's suitable for large payloads.
What's also great is that `http-form_data` is a generic gem which can be reused
by any HTTP client library, so the Ruby ecosystem can standardise on this
implementation instead of reinventing the wheel.

### Downloads

When you make a request with http.rb, the response headers are immediately
retrieved, but not the response body, giving you the chance to stream it if you
want to.

```rb
# retrieves the whole response body as a string
HTTP.get("http://example.com/download").to_s

# streams the response body in chunks
response = HTTP.get("http://example.com/download")
response.body.each do |chunk|
  # ...
end
```

This API allowed me to easily implement [on-demand downloads] for Shrine, which
is useful if you want to determine the MIME type of a remote file, but don't
want to download the whole file for that (MIME type can typically be determined
from the first few kilobytes of the file).

Net::HTTP also supports streaming the response body, but the API is much more
limiting due to having to wrap the streaming in the `Net::HTTP.start` block. I
was eventually able to implement on-demand downloads for Net::HTTP as well, but
I had to [use Fibers] to work around this limitation.

## Persistent Connections

Http.rb supports persistent (keep-alive) connections, which allows you to reuse
the same TCP socket for multiple requests to the same domain. This way you
don't have to pay the price of establishing a connection for each request, which
can make a significant difference in performance.

```rb
HTTP.get("https://example.com").to_s # connect + write + read + close
HTTP.get("https://example.com").to_s # connect + write + read + close
HTTP.get("https://example.com").to_s # connect + write + read + close
```
```rb
HTTP.persistent("https://example.com") do |http|
  http.get("/").to_s # connect + write + read
  http.get("/").to_s # write + read
  http.get("/").to_s # write + read
end                  # close

# OR

http = HTTP.persistent("https://example.com")
http.get("/").to_s # connect + write + read
http.get("/").to_s # write + read
http.get("/").to_s # write + read
http.close         # close
```

On a Heroku dyno, the first example takes about **1.1s**, whereas the example
that uses a persistent connection takes only **0.6s**, which shows that the
performance difference can be significant.

Net::HTTP also supports persistent connections, but requests have to be
performed inside the `Net::HTTP.start` block (alternatively you can use
[net-http-persistent]). HTTP client libraries built on top of libcurl
automatically use persistent connections (as that feature is built into
libcurl), so with them you don't need to think about it.

## Timeouts

Like most HTTP client libraries, http.rb allows you to specify connect and read
timeout. Connect timeout limits the time for opening the TCP connection, while
read timeout limits the time of reading a single chunk of the response.

```rb
http = HTTP.timeout(connect: 1, read: 1)
http.get("http://example.com") # raises HTTP::TimeoutError
```

Net::HTTP also has connect and read timeout, but it has a caveat for read
timeout – idempotent requests will be automatically retried on timeout error.
This means that, if you specify read timeout of 4 seconds, a request could
raise a timeout error only after 8 seconds, because it was already retried
once. See [this article][Net::HTTP timeout retry] for more details.

### Write timeout

In addition to connect and read timeout, http.rb also comes with a **write
timeout**. A write timeout limits the time it takes to write a single chunk of
the request. It's important to have this feature when sending requests with
large bodies, as those require multiple write system calls.

```rb
HTTP.timeout(connect: 1, write: 1, read: 1)
```

There is a [feature request][Net::HTTP write timeout] to add write timeout to
Net::HTTP, but as of this writing it hasn't been implemented yet. I'm not aware
of any HTTP client library that supports write timeouts.

### Global timeout

Requests can be written and responses can be read in multiple write or read
system calls. The default `:read` and `:write` timeout limits the time *for
each operation*. This means that if you set `:connect`, `:read`, and `:write`
timeouts to 1 second each, the request could still potentially take longer than
3 seconds if multiple write or read calls are executed.

Http.rb has the ability to specify a **global timeout**, where you can limit
the total amount of time the HTTP request can take. This is again most useful
with large amounts of data, where potentially many write/read system calls will
be executed.

```rb
# request can take 2 + 1 + 2 = 5 seconds in total
HTTP.timeout(:global, connect: 2, write: 1, read: 2)
```

It might be tempting to just wrap the whole HTTP call in a [`Timeout`] block,
but remember, [Timeout API is dangerous]. Http.rb implements read and write
timeouts natively, it only uses `Timeout` for the connect timeout (as doing it
natively is [a bit more involved][native connect timeout]).

## Compression

The HTTP 1.1 protocol supports compressing request and response bodies, which
decreases network resource usage, with the cost of increased CPU usage needed
for (de)compressing. This can improve speed when transferring large amounts of
data, depending on how well the request/response bodies compress.

Http.rb has support for automatically compressing ("deflating") request bodies:

```rb
HTTP.use(:auto_deflate)
    .post("http://example.com/upload", body: File.open("file.txt")) # compression

# POST /upload HTTP/1.1
# Content-Length: 53057934
# Content-Encoding: gzip  <========
#
# [compressed content]
```

and automatically decompressing ("inflating") response bodies:

```rb
HTTP.use(:auto_inflate)
    .get("http://example.com/download") # compression

# HTTP/1.1 200 OK
# Content-Length: 53057934
# Content-Encoding: gzip  <========
#
# [compressed content]
```

This works with streaming requests and responses. For regular requests the
total size needs to be calculated first for setting the `Content-Length`
request header, so in this case the compressed request body will be written
to disk before it's sent. But with [chunked requests] the request body will be
compressed on-the-fly, as those don't require the `Content-Length` request
header.

## Memory Usage

Ruby processes tend to consume a lot of memory. Ruby developers deal with this
in various ways: tweaking Ruby's GC settings, killing web workers once they
reach certain memory threshold, running the Ruby processes on jemalloc etc.
However, I think there are still many opportunities for reducing the amount of
objects we allocate in the first place, which is the approach that [Richard
Schneeman] ([derailed_benchmarks] & countless PRs), [Sam Saffron]
([rack-mini-profiler], [memory_profiler], [flamegraph], [RubyBench.org]), and
Eric Wong (Ruby commits) actively promote.

Eric Wong (Unicorn author and Ruby committer) recently talked about
this in a ruby-talk thread titled "[String memory use reduction techniques]".
There, Eric states that what is often to blame for high memory usage in Ruby
applications are **string objects**. He shows various techniques for limiting
string allocations, as well as deallocating strings that are no longer needed.
After all, the less "garbage" there is, the better the garbage collector will
perform :wink:

It so happens that HTTP intractions can allocate a lot of strings, especially
for large request and response bodies. I [measured][memory benchmark] memory
usage of http.rb, Net::HTTP, RestClient, and HTTParty when uploading and
downloading 10 MB of data. Here are the results:

| Library    | Uploading 10MB | Downloading 10MB |
| :--------- | -------------: | ---------------: |
| http.rb    | 0.10 MB        | 0.2 MB           |
| Net::HTTP  | 0.02 MB        | 12.36 MB         |
| RestClient | 9.03 MB        | 12.57 MB         |
| HTTParty   | 40.03 MB       | 12.59 MB         |

In the uploading benchmark, we can see that http.rb and Net::HTTP memory usage
is low, RestClient allocates 1x the request body size, and HTTParty allocates
4x the request body size. The http.rb memory usage is slightly higher, but it
appears to be constant regardless of the request body size. Note that with
uploads over SSL the memory usage will be much higher for each library, because
Ruby's `OpenSSL::SSL::SSLSocket` is currently very memory-inefficient (but
there is a [patch][openssl patch] waiting to be merged).

In the downloading benchmark, http.rb has very low memory usage which stays the
same regardless of the response body size, while the other libraries allocate
approximately 1x the response body size (due to Net::HTTP). Note that this
will be fixed in Ruby 2.6.0 due to Eric Wong's recent [patch][Net::HTTP
download patch], after which memory consumption drops to the same levels as
http.rb.

## Conclusion

I found http.rb to be a very impressive HTTP client library. It has a very nice
easy-to-use API, good exception hierarchy, full streaming support, persistent
connections, advanced timeout options, HTTP compression support and more.

I believe that one of the main things that helped it shape up is implementing
the HTTP protocol natively instead of relying on Net::HTTP. This also spawned
some reusable libraries – [Socketry], [http-form_data], and [content-type] –
which is always sound sign of good design in my book.

Since I maintain libraries for handling file uploads and downloads ([Shrine],
[Down], [tus-ruby-server]), it's important to me to have an HTTP client library
that I can recommend. The streaming upload/download support and very low memory
usage makes http.rb a great choice, especially when dealing with large files.

I encourage you to try http.rb on your next project!

[libcurl]: https://curl.haxx.se/libcurl/
[Typhoeus]: https://github.com/typhoeus/typhoeus
[Curb]: https://github.com/taf2/curb
[Patron]: https://github.com/toland/patron
[Net::HTTP]: https://ruby-doc.org/stdlib-2.5.0/libdoc/net/http/rdoc/Net/HTTP.html
[RestClient]: http://github.com/rest-client/rest-client
[HTTParty]: https://github.com/jnunemaker/httparty
[Nestful]: https://github.com/maccman/nestful
[HTTPClient]: https://github.com/nahi/httpclient
[Excon]: https://github.com/excon/excon
[http.rb]: https://github.com/httprb/http
[Faraday]: https://github.com/lostisland/faraday
[HTTPI]: https://github.com/savonrb/httpi
[Socketry]: https://github.com/socketry/socketry
[Enumerable]: https://ruby-doc.org/core-2.5.1/Enumerable.html
[Enumerator]: https://ruby-doc.org/core-2.5.1/Enumerator.html
[IO]: https://ruby-doc.org/core-2.5.1/IO.html
[`IO#read`]: http://ruby-doc.org/core-2.5.0/IO.html#method-i-read
[Shrine]: https://github.com/shrinerb/shrine
[`Shrine::UploadedFile`]: https://github.com/shrinerb/shrine/tree/c02a005869c536eeb234353f5b1129b9e2559559#uploaded-file
[`Down::ChunkedIO`]: https://github.com/janko/down/tree/55c9299c170b828d83487bae7df59cfe935a1e35#streaming
[multipart form data]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods/POST#Example
[http-form_data]: https://github.com/httprb/form_data
[`multipart-post`]: https://github.com/nicksieger/multipart-post
[Net::HTTP multipart form data]: https://github.com/ruby/ruby/blob/v2_5_1/lib/net/http/generic_request.rb#L210-L285
[RestClient multipart]: https://github.com/rest-client/rest-client/blob/v2.0.2/lib/restclient/payload.rb#L116-L207
[HTTParty multipart]: https://github.com/jnunemaker/httparty/blob/v0.16.2/lib/httparty/request/body.rb#L5
[use Fibers]: https://twin.github.io/partial-downloads-with-enumerators-and-fibers/
[on-demand downloads]: https://github.com/janko/down/tree/v4.5.0#streaming
[net-http-persistent]: https://github.com/drbrain/net-http-persistent
[Net::HTTP write timeout]: https://bugs.ruby-lang.org/issues/13396
[`Timeout`]: https://ruby-doc.org/stdlib-2.5.1/libdoc/timeout/rdoc/Timeout.html
[Timeout API is dangerous]: http://www.mikeperham.com/2015/05/08/timeout-rubys-most-dangerous-api/
[native connect timeout]: https://github.com/socketry/socketry/blob/ddc852443c66fc757f20cf0c0aacbaace6873ac4/lib/socketry/tcp/socket.rb#L81-L105
[chunked requests]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Transfer-Encoding
[String memory use reduction techniques]: https://rubytalk.org/t/psa-string-memory-use-reduction-techniques/74477
[memory benchmark]: https://gist.github.com/janko/238bbcc78b369ce3438365e5507bc671
[openssl patch]: https://bugs.ruby-lang.org/issues/14426
[Richard Schneeman]: https://schneems.com
[Sam Saffron]: https://samsaffron.com
[derailed_benchmarks]: https://github.com/schneems/derailed_benchmarks
[memory_profiler]: https://github.com/samsaffron/memory_profiler
[RubyBench.org]: https://rubybench.org
[flamegraph]: https://github.com/SamSaffron/flamegraph
[rack-mini-profiler]: https://github.com/MiniProfiler/rack-mini-profiler
[content-type]: https://github.com/httprb/content_type.rb
[Down]: https://github.com/janko/down
[tus-ruby-server]: https://github.com/janko/tus-ruby-server
[Net::HTTP download patch]: https://bugs.ruby-lang.org/issues/14326
[Net::HTTP timeout retry]: https://engineering.wework.com/ruby-users-be-wary-of-net-http-f284747288b2
