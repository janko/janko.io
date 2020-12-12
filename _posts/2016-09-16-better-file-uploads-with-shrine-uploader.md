---
title: "Better File Uploads with Shrine: Uploader"
tags: shrine
excerpt: "This is the 2nd part of a series of blog posts about Shrine. In this
  part I talk about the foundation that Shrine is built upon – uploaders."
updated: 15.9.2019.
---

In the [previous post] I talked about motivation behind creating Shrine. In
this post I want to show you the foundation that Shrine is built upon –
storage, uploader and uploaded file.

## Storage

A Shrine "storage" is a plain Ruby object which encapsulates managing files on a
particular storage service (filesystem, S3 etc). The storage needs to respond
to the following 5 methods:

```rb
class MyStorage
  def upload(io, id, **options)
    # uploads the `io` to the given location `id`
  end

  def url(id, **options)
    # returns the URL to the file on location `id`
  end

  def open(id, **options)
    # returns the file on location `id` as an IO-like object
  end

  def exists?(id)
    # returns whether storage has a file on location `id`
  end

  def delete(id)
    # deletes the file on location `id` from the storage
  end
end
```

Shrine storages are configured directly by passing options to `new` (inspired by
Refile), and registered in `Shrine.storages`:

```rb
Shrine.storages[:s3] = Shrine::Storage::S3.new(
  access_key_id:     "<YOUR_ACCESS_KEY_ID>",
  secret_access_key: "<YOUR_SECRET_ACCESS_KEY>",
  region:            "<YOUR_REGION>",
  bucket:            "<YOUR_BUCKET>",
)
```

Currently there are [FileSystem], [S3], [Fog], [Flickr], [Cloudinary],
[Transloadit], [Uploadcare], [GridFS] and [SQL] storage for Shrine, so
take your pick :wink:

You can also easily write your own storage, there is a [guide][creating
storage] for it, and a [linter] which will automatically test if your storage
is working corrrectly.

## Uploader

Uploaders are subclasses of `Shrine`, and they encapsulate uploading logic for
a specific attachment (inspired by CarrierWave).

```rb
class ImageUploader < Shrine
  # image uploading logic goes here
end
```

Uploader objects act as wrappers around a storage, performing all functionality
around uploading that is generic to any storage:

* extracting metadata
* generating location
* uploading (this is where the storage is called)
* closing uploaded file

Uploaders are instantiated with the registered storage name:

```rb
Shrine.storages[:disk] = Shrine::Storage::FileSystem.new(...)
```
```rb
uploader = ImageUploader.new(:disk)
uploader.upload(image) #=> #<Shrine::UploadedFile>
```

Uploaders don't know about models; they only take a file to be uploaded on the
input, and return representation of the uploaded file on the output. As this
suggests, uploaders are stateless, which makes their behaviour really easy to
reason about.

## Uploaded file

When a file is uploaded through the uploader, the `#upload` method returns a
`Shrine::UploadedFile` value object. This object is a complete representation
of the file that was uploaded to the storage.

```rb
uploaded_file = uploader.upload(image) #=> #<Shrine::UploadedFile>

uploaded_file.id       #=> "43ksd9gkafg0dsl.jpg"
uploaded_file.storage  #=> #<Shrine::Storage::FileSystem>
uploaded_file.metadata #=> {...}
```

Since this object knows which storage it was uploaded to, it is able to provide
many useful methods:

```rb
uploaded_file.url               # generates the URL
uploaded_file.download          # downloads the file to the disk
uploaded_file.exists?           # asks the storage if file exists
uploaded_file.open { |io| ... } # opens the file for reading
uploaded_file.delete            # deletes the file from the storage
```

This object is defined solely by its data hash. Since the storage can be
referenced by its registered name, this hash can now be serialized into JSON,
and saved to a database column.

```rb
uploaded_file.data #=>
# {
#   "id"       => "df9fk48saflg.jpg",
#   "storage"  => "disk",
#   "metadata" => {...}
# }

uploaded_file.to_json #=> '{"id":"df9fk48saflg.jpg","storage":"disk","metadata":{...}}'
```

The `Shrine::UploadedFile` objects are separate from uploaders. This is a
contrast to CarrierWave and Paperclip, which have this behaviour mixed in into
their `CarrierWave::Uploader::Base` and `Paperclip::Attachment` god classes.

## IO abstraction

Shrine is able to upload any IO-like object which responds to `#read`, `#size`,
`#rewind`, `#eof?` and `#close` (inspired by Refile). By definining this strict
interface, every Shrine feature now knows they can rely only on these methods,
which means they will work correctly regardless of whether you're uploading
File, StringIO, ActionDispatch::Http::UploadedFile, [Rack files], or [remote
files which download themselves as you read them][Down::ChunkedIO].

Furthermore, `Shrine::UploadedFile` is *itself* an IO-like object, wrapping
any uploaded file under the same unified interface. This makes reuploading the
file from one storage to another really natural. Furthermore, this allows the
storage to *optimize* some uploads by skipping downloading & reuploading, for
example use an [S3 copy] if both files are from S3, or just send the remote URL
if the storage supports it.

```rb
cache = ImageUploader.new(:s3_temporary)
cached_file = cache.upload(image)

store = ImageUploader.new(:s3_permanent)
store.upload(cached_file) #=> performs an S3 COPY request
```

## Plugin system

Shrine comes with a small core (< 500 LOC) which provides the essential
functionality. Any additional features can be loaded via [plugins]. This gives
you the flexibility to choose exactly what and how much Shrine does for you,
and load the code only for features that you use.

```rb
# Loads the instrumentation feature from "shrine/plugins/instrumentation.rb"
Shrine.plugin :instrumentation
```

Shrine ships with over 40 plugins, and it's easy to [write your own][writing
plugins]. Shrine's plugin system is an adaptation of [Roda]'s, which I [wrote
about][plugin system] in the past.

Also, Shrine uploaders respect inheritance ([unlike CarrierWave][carrierwave
inheritance]).

```rb
Shrine.plugin :determine_mime_type # determine MIME type for all uploaders

class ImageUploader < Shrine
  plugin :store_dimensions # extract dimensions only for images
end
```

## Dependencies

Most file attachment libraries have pretty heavy dependencies.

* CarrierWave
  - ActiveSupport – I really don't want all those monkey patches
  - ActiveModel – Why not implement validations [without a library][validation_helpers]?
  - MIME::Types – It's better to determine MIME type from file content
* Paperclip
  - ActiveSupport – Again, I want to have a choice of not having any monkey patches
  - ActiveModel – Ok, both AM and AS are required by ActiveRecord anyway
  - Cocaine – [Open3] is already a great standard library for running shell commands
  - MIME::Types – The MIME type spoofing detection has proven [very unreliable][paperclip mime] anyway
  - MimeMagic – I'm already very satisfied with the [file] utility
* Refile
  - RestClient – Heavy dependency to use just for downloading
  - Sinatra – That's fine, although [Roda] is a much lighter dependency
  - MIME::Types – It's better to determine MIME type from file content

Shrine, on the other hand, has two lightweight dependencies – [Down] and
[content_disposition] gems – which are only loaded as needed.

The lightweight dependencies and plugin system makes Shine load very fast,
because you're loading code only for features that you use. For comparison,
Shrine loads **35x** faster than CarrierWave without any plugins loaded, and
**7x** faster with *all* plugins loaded ([source][shrine-carrierwave load
time]).

## Conclusion

Every high-level interface should have good foundation. That way whichever
level of abstraction you need to drop to, you can always understand what's
going on. Shrine's foundation is composed out of Storage, `Shrine` and
`Shrine::UploadedFile` classes, each having well-defined responsibilities and
interface.

In the next post I will talk about Shrine's high-level attachment interface,
and again compare it to existing file upload libraries, so stay tuned!

[Shrine]: https://github.com/shrinerb/shrine
[previous post]: https://twin.github.io/better-file-uploads-with-shrine-motivation/
[plugins]: http://shrinerb.com/#plugins
[writing plugins]: https://shrinerb.com/docs/creating-plugins
[carrierwave inheritance]: https://jbhannah.net/articles/carrierwave-concerns/
[Roda]: https://github.com/jeremyevans/roda
[plugin system]: https://twin.github.io/the-plugin-system-of-sequel-and-roda/
[direct uploads]: https://github.com/shrinerb/shrine#direct-uploads
[Rack files]: https://shrinerb.com/docs/plugins/rack_file
[Down::ChunkedIO]: https://github.com/janko/down#streaming
[S3 copy]: http://docs.aws.amazon.com/sdkforruby/api/Aws/S3/Object.html#copy_from-instance_method
[validation_helpers]: https://github.com/shrinerb/shrine/blob/master/lib/shrine/plugins/validation_helpers.rb
[Open3]: http://ruby-doc.org/stdlib-2.3.0/libdoc/open3/rdoc/Open3.html
[paperclip mime]: https://github.com/thoughtbot/paperclip/issues?utf8=%E2%9C%93&q=label%3A%22Spoof%20related%20or%20Mime%20types%22%20
[file]: http://linux.die.net/man/1/file
[Down]: https://github.com/janko/down
[content_disposition]: https://github.com/shrinerb/content_disposition
[shrine-carrierwave load time]: https://gist.github.com/janko/0d4269b9c7195b5e65cc947acf1cc028
[FileSystem]: https://github.com/shrinerb/shrine/blob/master/lib/shrine/storage/file_system.rb
[S3]: https://github.com/shrinerb/shrine/blob/master/lib/shrine/storage/s3.rb
[Fog]: https://github.com/shrinerb/shrine-fog
[Flickr]: https://github.com/shrinerb/shrine-flickr
[Cloudinary]: https://github.com/shrinerb/shrine-cloudinary
[Transloadit]: https://github.com/shrinerb/shrine-transloadit
[Uploadcare]: https://github.com/shrinerb/shrine-uploadcare
[Imgix]: https://github.com/shrinerb/shrine-imgix
[GridFS]: https://github.com/shrinerb/shrine-gridfs
[SQL]: https://github.com/shrinerb/shrine-sql
[creating storage]: https://shrinerb.com/docs/creating-storages
[linter]: https://github.com/shrinerb/shrine/blob/master/lib/shrine/storage/linter.rb
