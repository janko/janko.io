---
title: Partial Downloads with Enumerators and Fibers
tags: ruby download streaming partial
---

Before talking about the implementation, I first want to explain where and why
I needed partial downloads.

When handling file attachments with [Shrine], in addition to uploading files
through your app, you can have files [uploaded directly] to Amazon S3. Then when
you submit the form to your app, only the path to the file on S3 is sent
over-the-wire.

Upon receiving the request, we should always validate that the file type of the
file, called the **MIME type**, is the one that we expect. Otherwise [bad
things can happen]. We might be tempted to just read the media type from the
"Content-Type" request header, but this value is either derived from file's
extension, or it's chosen by the client, so relying on that value isn't secure.

Instead, we need to determine the MIME type from file *content*. There are
already many great and robust tools for doing this, like [MimeMagic] or the
[file command].

This is fast for local files, but when we receive just locations to directly
uploaded *remote* files, we would first need to download them in order to
determine their MIME type. And that kind of defeats the purpose of having
direct uploads in the first place, because the whole point was for the form
submission to be fast. Even for small files like images the performance hit is
very noticeable, and for larger files like videos it simply wouldn't be
feasible.

There is already one solution for this in Ruby.

### Fastimage

[Fastimage] is a library which can quickly determine MIME type (and dimensions)
of remote images, and is used in [carrierwave-bombshelter]. It relies on the
fact that, for common file types, the "magic bytes" which determine the MIME
type are always written somewhere in the beginning of a file. So, instead of
downloading the whole file, it downloads only enough to read the "magic bytes".

```rb
require "fastimage"
Fastimage.type("http://example.com/image.jpg") #=> :jpeg
```

However, as its name suggests, one limitation of Fastimage is that it works
only for images (and only main types). And in Shrine I want generic solutions,
ones which will work for all types of files. Also, images aren't the only ones
enjoying exploits, [videos have them too].

Let's remind ourselves that we already *have* robust tools for determining the
MIME type for all types of files, tools like [MimeMagic] or [file command]
which I've already mentioned. Now we just need to figure out how to download
only the amount of bytes that we need.

## Partial download

Since Shrine already uses the `net/http` and it's part of Ruby's standard
library, I wanted to see if I can use it for partial downloads as well. And
`net/http` happens to have the ability yield chunks of the response body as
they are downloaded:

```rb
require "net/http"
uri = URI("http://example.com/image.jpg")
Net::HTTP.start(uri.host, uri.port) do |http|
  http.request_get(uri.path) do |response|
    response.read_body do |chunk|
      puts chunk
    end
  end
end
```

Let's use this to download only the first 256KB of the file:

```rb
partial_content = ""
Net::HTTP.start(uri.host, uri.port) do |http|
  http.request_get(uri.path) do |response|
    response.read_body do |chunk|
      partial_content << chunk
      break if partial_content.size >= 256 * 1024
    end
  end
end
```

Once we have this content, we can feed it to the `file` command:

```rb
require "open3"
output, status = Open3.capture2("file --mime-type --brief -", stdin_data: partial_content)
mime_type = output.strip
mime_type #=> "image/jpeg"
```

Great, we have something here, but what I would ideally want is an object which
represents the whole remote file. This way if we want to extract more
information (e.g. [image dimensions] or EXIF), each analyzer can just download
how much it needs.

Shrine already has a great abstraction -- IO-like interface. Whether a file is
on the local filesystem, Amazon S3, or a blob in the database, as long it is
represented by an IO wrapper object, Shrine knows how to perform uploading or
extracting metadata. So, it would be perfect if we could represent our remote
file as an IO object:

```rb
remote_file # Some kind of IO object
remote_file.read(1024) # downloads and returns first 1 KB
remote_file.read(1024) # downloads and returns next 1 KB
remote_file.close # terminates the download
```

## Enumerators & Fibers

The main element of our wishful interface is the ability to
start/pause/continue/stop the download whenever we want. We can achieve this by
tranforming `#read_body` into an [Enumerator], which allows us to easily
download only as many chunks as we need to:

```rb
Net::HTTP.start(uri.host, uri.port) do |http|
  http.request_get(uri.path) do |response|
    chunks = response.enum_for(:read_body)
    chunks.next #=> downloads the first chunk
    chunks.next #=> downloads the next chunk
  end
end
```

But how can we return this enumerator in a method? The `#read_body` enumerator
cannot continue yielding chunks *outside* of `Net::HTTP.start {}`, because at
the end of the block connection is terminated. We can call `Net::HTTP.start`
without a block, and then call `Net::HTTP.finish` only later when we want to
terminate the connection. However, we are still constrained by the
`http.request_get {}` block, and we cannot get around it, because the blockless
version forces the whole response body to be read.

```rb
http = Net::HTTP.start(uri.host, uri.port)
response = http.request_get(uri.path) # downloads the whole response body
response.read_body { } # IOError: Net::HTTPOK#read_body called twice
http.finish
```

So, what we need to do is get the `response` object, and then somehow stop
further execution. After a lot of thinking, it finally hit me -- [Fibers].
Fibers allow you pause the execution using `Fiber.yield`, and then
`Fiber#resume` at any point. Let's use Fibers to get our `response` and pause
terminating the connection.

```rb
fiber = Fiber.new do
  Net::HTTP.start(uri.host, uri.port) do |http|
    http.request_get(uri.path) do |response|
      Fiber.yield response # returns response and pauses the execution
    end
  end
end

# nothing is executed yet

response = fiber.resume
chunks = response.enum_for(:read_body)

# ...

fiber.resume # closes the connection
```

## Solution

Now that we have an enumerator which downloads and returns chunks, the final
piece of the puzzle is to make an IO-like wrapper around it -- an object which
responds to `#read`, `#size`, `#rewind`, `#eof?`, and `#close`.

The result of this idea is [Down::ChunkedIO]. What this object does is it
caches the downloaded content into a Tempfile, and when `read(bytes)` is
called, it downloads only how much it needs to be able to return the requested
number of bytes. It is instantiated with the following options:

* `:chunks` -- An enumerator which yields chunks of content
* `:size` -- A number that `#size` will return
* `:on_close` -- A block that will be called on `#close`

With this in mind, we now have the complete solution to our original problem:

```rb
require "down"
require "open3"

uri = URI("http://example.com/image.jpg")

# Use Fiber to control the execution
request = Fiber.new do
  Net::HTTP.start(uri.host, uri.port) do |http|
    http.request_get(uri.path) do |response|
      Fiber.yield response
    end
  end
end

# Get the response object, and delay closing the connection
response = request.resume

# An IO object representing the file at "http://example.com/image.jpg"
remote_file = Down::ChunkedIO.new(
  chunks:   response.enum_for(:read_body),
  size:     (response["Content-Length"].to_i if response["Content-Length"]),
  on_close: -> { request.resume },
)

# First 256KB proved to be enough to determine the MIME type
stdin = remote_file.read(256 * 1024)
output, status = Open3.capture2("file --mime-type --brief -", stdin_data: stdin)
mime_type = output.strip

remote_file.close # terminate the HTTP connection

mime_type #=> "image/jpeg"
```

Since `Down::ChunkedIO` downloads lazily, it will stop as soon as it downloads
the sufficient number of bytes. I tested this with a 75MB video on S3: it took
90 seconds to download the whole video, but only 3.5 seconds to download the
first 256KB.

## Final notes

If you want to use this behaviour, it is integrated into the [down] gem. I'm
really happy that I could implement this behaviour using Shrine's "IO"
abstraction, since it allowed me to switch from fully downloaded file to
partial download without having to change any of Shrine's existing code.

The reason I wanted to share this with you is because for me it was an
interesting and advanced problem, which had a real-world use case. It really
brings me joy how powerful Ruby can be, once you have good knowledge of it.

[Shrine]: https://github.com/janko-m/shrine
[bad things can happen]: https://imagetragick.com/
[uploaded directly]: http://shrinerb.com/rdoc/classes/Shrine/Plugins/DirectUpload.html
[MimeMagic]: https://github.com/minad/mimemagic
[file command]: http://linux.die.net/man/1/file
[Fastimage]: https://github.com/sdsykes/fastimage
[carrierwave-bombshelter]: https://github.com/DarthSim/carrierwave-bombshelter
[videos have them too]: http://news.softpedia.com/news/zero-day-ffmpeg-vulnerability-lets-anyone-steal-files-from-remote-machines-498880.shtml
[image dimensions]: http://shrinerb.com/rdoc/classes/Shrine/Plugins/StoreDimensions.html
[Fibers]: http://ruby-doc.org/core-2.3.0/Fiber.html
[Enumerator]: http://ruby-doc.org/core-2.3.0/Enumerator.html
[Down::ChunkedIO]: https://github.com/janko-m/down/blob/792413889a57defb72ec9166a553c3ebd0441f88/lib/down.rb#L136
[down]: https://github.com/janko-m/shrine
