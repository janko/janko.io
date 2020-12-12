---
title: Resumable File Uploads in Ruby
tags: shrine
---

I recently released [tus-ruby-server], a Ruby server implementation for [tus],
an open protocol for resumable file uploads built on HTTP.

## Protocol

Let's first briefly explain what is tus. Tus is a [specification] that
describes the communication between the client and the server through HTTP for
achieving reliable and resumable file uploads, even on unstable networks. Check
out the [demo].

"Resumable upload" doesn't mean giving your user a button to resume the upload
whenever there is a network hiccup. It means having the client automatically
reinitiate interrupted uploads without the user knowing about it. Tus enables
resuming the upload even after the user closes the browser or shuts down the
device, as long as the user selects the same file.

Tus was created by [Transloadit], and has received feedback from well-known
companies like Vimeo, Google and GitHub.

## Implementations

There are many client-side implementations, including [JavaScript],
[iOS][TUSKit] and [Android][tus-android-client], as well as server-side
implementations, covering [Go], [Node.js], [Python], [Java], [PHP], [.NET] and
others.

There already is an existing Ruby server implementation, [Rubytus]. However,
there are two main reasons why I decided to write my own:

One reason is that at the time of this writing Rubytus supported an older
version of the protocol. When I attempted to bring it to tus 1.0, I realized
that many things have changed since that version.

Another reason is that it's written in a non-standard web framework, [Goliath].
Goliath is a non-blocking Ruby web framework built on top of [EventMachine]. I
think Goliath is great when you want to scale apps that do a lot of IO (like
database writing and HTTP requests), but here we're just writing files to the
filesystem. And while Goliath definitely has a nice callback-less API, you
still have to be aware that you're writing asynchronous code, which made it
difficult for me to precisely implement the protocol.

## Ruby server

The [tus-ruby-server] fully implements the tus protocol with all its
extensions, and it's written in [Roda], for me the best web framework for
writing APIs. With Roda you can route and handle requests in a very linear and
DRY way, which allowed me to precisely follow the specification and return the
appropriate status and HTTP headers for various situations.

But from the developer's perspective, [tus-ruby-server] is just a Rack app
which you can run standalone or as part of your app:

```rb
# Gemfile
gem "tus-server"
```

```rb
# config.ru
require "tus/server"

map "/files" do
  run Tus::Server
end
```

On the client-side you can now use [tus-js-client] to listen on file select,
and initiate a tus upload to the endpoint.

```js
fileInput.addEventListener("change", function(e) {
  var file = e.target.files[0];

  var upload = new tus.Upload(file, {
    endpoint:  "http://localhost:9292/files/",
    chunkSize: 15*1024*1024, // 15MB
  });

  upload.start();
});
```

After upload is complete you will get a URL to the uploaded file, and you'll
probably want to attach it to a database record. [Shrine] is one file
attachment library that supports attaching by custom URLs using [shrine-url],
see [shrine-tus-demo] on how you can integrate these.

```
http://localhost:9292/files/ebfe84d3921ce31fe603c6a9ae5f81b8
```

Other popular file attachment libraries like CarrierWave, Paperclip, Refile or
Dragonfly also support attaching remote files via URLs, but they will also
automatically download the file. This is not really feasible here, because
these files will typically be fairly large (that's why we're using this
protocol in the first place).

Shrine allows you to save only the URL, and spawn a background job which will
upload this file to a storage of your choice. This keeps the form submission
instantaneous.

Ok, now that we got the integration out of the way, I thought it would be
interesting to go over some parts of the tus protocol, to see how it can
improve the general user experience around file uploads.

### Uploading

Tus enables file data to be sent in multiple PATCH requests:

```http
PATCH /files/{uid} HTTP/1.1
Content-Type: application/offset+octet-stream
Content-Length: 30
Upload-Offset: 0
Tus-Resumable: 1.0.0

[ first 30 bytes ]
```
```http
PATCH /files/{uid} HTTP/1.1
Content-Type: application/offset+octet-stream
Content-Length: 70
Upload-Offset: 30
Tus-Resumable: 1.0.0

[ next 70 bytes ]
```

The interesting header here is `Upload-Offset`, which allows the client to
continue sending more data to an existing upload. This means the client can
split large files into multiple chunks, and repeat PATCH requests that failed
due to network issues.

### Concatenation

In addition to appending to an existing upload, the protocol also supports
uploading the chunks individually, and then concatenating them into a single
file. This allows the client to upload multiple chunks in parallel, which
can provide a significant overall speedup:

> [...] on our internal network, sending a 110 MB file to S3 with chunk sizes of 5 MB took about 22 seconds when chunks were uploaded one-at-a-time (with concurrent chunking disabled). When maxing out the default maxConnections for that file (3 chunks at once, concurrent chunking enabled) the same file uploaded in about 12 seconds.
>
> — Ray Nicholus, creator of [FineUploader]

We could for example upload two chunks:

```http
PATCH /files/a HTTP/1.1
Upload-Concat: partial
Upload-Offset: 0
Content-Length: 5

hello
```
```http
PATCH /files/b HTTP/1.1
Upload-Concat: partial
Upload-Offset: 0
Content-Length: 6

 world
```

And then concatenate them into a single file:

```http
POST /files HTTP/1.1
Upload-Concat: final;/files/a /files/b
```
```http
HTTP/1.1 201 Created
Location: /files/ab
```

The length of the final resource is now 11 bytes consisting of `hello world`:

```http
HEAD /files/ab HTTP/1.1
```
```http
HTTP/1.1 200 OK
Upload-Length: 11
Upload-Concat: final;/files/a /files/b
```

### Checksum

Networks are not reliable, and sometimes [bytes can get lost]. That's why tus
allows the client to send a checksum of the data it's sending.

```http
PATCH /files/{uid} HTTP/1.1
Content-Length: 11
Upload-Offset: 0
Upload-Checksum: sha1 Kq5sNclPz7QV2+lfQIuc6R7oRu0=

hello world
```

When server receives the data, it too can generate a checksum of the received
data using the same algorithm, and verify that it matches the received one.

```http
HTTP/1.1 204 No Content
Upload-Offset: 11
```

### Termination

In addition to resuming, with tus you can also give users the ability to
terminate uploads, which deletes the data that was uploaded up to that point.

```http
DELETE /files/{uid} HTTP/1.1
```

### Storage

The tus-ruby-server implementation by default stores uploaded files on the
filesystem. However, the downside of storing files on the filesystem is that
it isn't distributed, so for the resumable uploads to work you would have to
host tus-ruby-server on a single server.

That might or might not be a bottleneck, depending on the rate of file uploads
you're accepting. Alternatively you can choose the Mongo [GridFS] storage,
which among other things is convenient for multi-server setup.

```rb
require "tus/server"
require "tus/storage/gridfs" # requires the "mongo" gem

client = Mongo::Client.new("mongodb://127.0.0.1:27017/mydb")
Tus::Server.opts[:storage] = Tus::Storage::Gridfs.new(client: client)
```

You can also write your own storage which implements the same interface as
[`Tus::Storage::Filesystem`] and [`Tus::Storage::Gridfs`].

## Limitations

One advantage of Rubytus is that the Goliath web framework is able to handle
interrupted PATCH requests, by saving all the data it has received before the
HTTP connection was closed.

```rb
# Code is from https://github.com/picocandy/rubytus

class TusServer < Goliath::API
  # executed when headers are received
  def on_headers(env, headers)
    # ...
  end

  # executed whenever part of the body is received
  def on_body(env, data)
    if env["REQUEST_METHOD"] == "PATCH"
      env["api.buffers"] << data # save the received data
    else
      env["rack.input"] = StringIO.new(data) # default behaviour
    end
  end

  # executed when the connection is closed (either completed or interrupted)
  def on_close(env)
    if env["REQUEST_METHOD"] == "PATCH"
      storage.patch_file(env["api.uid"], env["api.buffers"]) # store the received data
    end
  end
end
```

Tus-ruby-server is implemented in Roda, which is built on top of Rack (like most
other web frameworks), and from research that I performed, web servers for Rack
applications don't have a configuration option for forwarding interrupted
requests to the app.

By default tus-js-client will use only a single PATCH request to upload the
whole file, and send additional ones if the connection gets interrupted. So you
just need to configure tus-js-client or whichever client library you're using
to upload in multiple chunks. This way if the connection gets interrupted, all
previously uploaded chunks will remain on the server.

```js
new tus.Upload(file, {
  endpoint:  "http://localhost:9292/files/",
  chunkSize: 15*1024*1024, // 15MB
});
```

Since chunked uploads can even significantly speed up the general upload if you
use parallelization, not being able to resume an upload of a single PATCH
request practically shouldn't be a significant limitation.

## Conclusion

I'm really excited that, rather than each company implementing their own
protocol, we now have an open stable resumable upload protocol which we can all
agree on, and build generic client and server libraries which everyone can use.

With [tus-ruby-server] and [Shrine] on the server, and
[tus-js-client] / [TUSKit] / [tus-android-client] on the client, anyone can now add
resumable file uploads to their Ruby applications.

[tus]: http://tus.io/
[specification]: http://tus.io/protocols/resumable-upload.html
[demo]: http://tus.io/demo.html
[tus-ruby-server]: https://github.com/janko/tus-ruby-server
[tus-js-client]: https://github.com/tus/tus-js-client
[Transloadit]: https://transloadit.com/
[JavaScript]: https://github.com/tus/tus-js-client
[TUSKit]: https://github.com/tus/TUSKit
[tus-android-client]: https://github.com/tus/tus-android-client
[Go]: https://github.com/tus/tusd
[Node.js]: https://github.com/tus/tus-node-server
[Python]: https://github.com/matthoskins1980/Flask-Tus
[Java]: https://github.com/terrischwartz/tus_servlet
[PHP]: https://github.com/leblanc-simon/php-tus
[.NET]: https://github.com/smatsson/tusdotnet
[Rubytus]: https://github.com/picocandy/rubytus
[Goliath]: https://github.com/postrank-labs/goliath
[EventMachine]: https://github.com/eventmachine/eventmachine
[Roda]: https://github.com/jeremyevans/roda
[Shrine]: https://github.com/shrinerb/shrine
[shrine-url]: https://github.com/shrinerb/shrine-url
[shrine-tus-demo]: https://github.com/shrinerb/shrine-tus-demo
[FineUploader]: http://fineuploader.com/
[bytes can get lost]: https://github.com/tus/tus-resumable-upload-protocol/issues/7#issuecomment-16568773
[GridFS]: https://docs.mongodb.org/v3.0/core/gridfs/
[`Tus::Storage::Filesystem`]: https://github.com/janko/tus-ruby-server/blob/master/lib/tus/storage/filesystem.rb
[`Tus::Storage::GridFS`]: https://github.com/janko/tus-ruby-server/blob/master/lib/tus/storage/gridfs.rb
