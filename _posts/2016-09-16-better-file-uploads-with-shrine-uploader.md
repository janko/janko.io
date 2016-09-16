---
title: "Better File Uploads with Shrine: Uploader"
tags: ruby file attachment upload shrine library gem
excerpt: "This is the 2nd part of a series of blog posts about Shrine. In this
  part I talk about the foundation that Shrine is built upon – uploaders."
---

*This is 2nd part of a series of blog posts about [Shrine]. The aim of this
series is to show the advantages of using Shrine over other file attachment
libraries.*

----

In the [previous post] I talked about motivation behind creating Shrine. In
this post I want to show you the foundation that Shrine is built upon –
uploaders. I will explain the reason for some design decisions, and how they
result in better flexibility.

## Storage

In Shrine "storages" are plain Ruby classes which encapsulate managing files on
a particular storage service (filesystem, S3 etc). They are instantiated and
configured directly (inspired by Refile):

```rb
# Uploads to "public/uploads/cache", where "uploads/cache" is included in the URL
Shrine::Storage::FileSystem.new("public", prefix: "uploads/cache")
```

In contrast, CarrierWave requires configuring the storage through the uploader,
thus mixing storage options with general configuration, which introduces
coupling between the storage and the uploader.

```rb
CarrierWave.configure do |config|
  # General configuration
  config.storage :fog
  config.cache_dir = "..."

  # Fog-specific configuration
  config.fog_provider    = "fog/aws"
  config.fog_credentials = {...}
  config.fog_directory   = "my-bucket"
  config.fog_public      = true
end
```

Paperclip also mixes storage options which general options:

```rb
Paperclip.default_options.merge!(
  # General options
  styles: {...},
  storage: :s3,

  # S3-specific configuration
  s3_credentials: {...},
  s3_region: "..."
  bucket: "my-bucket",
)
```

Paperclip introduces further coupling by requiring the storage to [know about
Paperclip's interpolations][paperclip interpolations]. Shrine always generates
the location beforehand, and the storage just receives the direct path to where
it should upload the given file.

Currently there is [FileSystem], [S3], [Fog], [Flickr], [Cloudinary],
[Transloadit], [Uploadcare], [Imgix], [GridFS] and [SQL] storage for Shrine, so
take your pick :wink:

## Uploader

Uploaders are subclasses of `Shrine`, and they encapsulate uploading logic for
a specific attachment (inspired by CarrierWave).

```rb
class ImageUploader < Shrine
  # image uploading logic goes here
end
```

Uploader objects act as wrappers around a storage, performing all functionality
that is generic to any storage (processing, generating location, extracting
metadata, logging, closing the uploaded file etc), before giving the file to
the storage.

```rb
# We first register the storage globally
Shrine.storages[:disk] = Shrine::Storage::FileSystem.new(...)
```
```rb
# Then we can reference this storage by the registered name
uploader = ImageUploader.new(:disk)
uploader.upload(image) #=> #<Shrine::UploadedFile>
```

Uploaders don't know about models; they only take a file to be uploaded on the
input, and return representation of the uploaded file on the output. As this
suggests, uploaders are stateless, which makes their behaviour really easy to
reason about.

Contrary to that, `CarrierWave::Uploader::Base` and `Paperclip::Attachment` are
very complex god objects, and the complexity comes from always having to update
a lot of state, and not having clear reponsibility.

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

In contrast, Paperclip has a [very wide range of IO adapters][paperclip IO
adapters] which all first copy/download the file to disk, eliminating the
possibility for the above performance optimizations, and
[increasing][paperclip#1326] [copying][paperclip#1642].

## Plugin system

Shrine comes with a small [core] (< 500 LOC) which provides the essential
functionality. Any additional features can be loaded via [plugins]. This gives
you the flexibility to choose exactly what and how much Shrine does for you,
and load the code only for features that you use.

```rb
# Loads the processing feature from "shrine/plugins/logging.rb"
Shrine.plugin :logging, logger: Rails.logger
```

Shrine ships with over 35 plugins, and it's easy to [write your own][writing
plugins]. Shrine's plugin system is an adaptation of [Roda]'s, which I [wrote
about][plugin system] in the past.

Also, Shrine uploaders respect inheritance ([unlike CarrierWave][carrierwave
inheritance]).

```rb
Shrine.plugin :logging # enables logging for all uploaders

class ImageUploader < Shrine
  plugin :backup # stores backups only for this uploader (and its descendants)
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

Shrine, on the other hand, has only one mandatory lightweight dependency –
[Down]. Down is a net/http wrapper for downloading files, which [improves upon
open-uri][down open-uri] and has support for [streaming downloads][down
streaming], and is used by almost every Shrine storage.

Furthermore, Shrine in general loads really fast, because you're loading code
only for features that you use. Other file attachment libraries require you to
load code for many features that you might not need. To illustrate, Shrine
loads **35x** faster than CarrierWave without any plugins loaded, and **7x**
faster with *all* plugins loaded ([source][shrine-carrierwave load time]).

## Conclusion

Every high-level interface should have good foundation. That way whichever
level of abstraction you need to drop to, you can always understand what's
going on. Shrine's foundation is composed out of Storage, `Shrine` and
`Shrine::UploadedFile` classes, each having well-defined responsibilities and
interface.

In the next post I will talk about Shrine's high-level attachment interface,
and again compare it to existing file upload libraries, so stay tuned!

[Shrine]: https://github.com/janko-m/shrine
[previous post]: https://twin.github.io/better-file-uploads-with-shrine-motivation/
[core]: https://github.com/janko-m/shrine/blob/master/lib/shrine.rb
[plugins]: http://shrinerb.com/#plugins
[writing plugins]: http://shrinerb.com/#plugins
[carrierwave inheritance]: https://jbhannah.net/articles/carrierwave-concerns/
[Roda]: https://github.com/jeremyevans/roda
[plugin system]: https://twin.github.io/the-plugin-system-of-sequel-and-roda/
[direct uploads]: http://shrinerb.com/rdoc/files/doc/direct_s3_md.html
[paperclip interpolations]: https://github.com/thoughtbot/paperclip/blob/7edb35a2a9a80c9598dfde235c7e593c023fc914/lib/paperclip/storage/s3.rb#L169-L187
[paperclip IO adapters]: https://github.com/thoughtbot/paperclip/tree/master/lib/paperclip/io_adapters
[Rack files]: http://shrinerb.com/rdoc/classes/Shrine/Plugins/RackFile.html
[Down::ChunkedIO]: https://github.com/janko-m/down#streaming
[S3 copy]: http://docs.aws.amazon.com/sdkforruby/api/Aws/S3/Object.html#copy_from-instance_method
[paperclip#1326]: https://github.com/thoughtbot/paperclip/issues/1326
[paperclip#1642]: https://github.com/thoughtbot/paperclip/issues/1642
[validation_helpers]: https://github.com/janko-m/shrine/blob/master/lib/shrine/plugins/validation_helpers.rb
[Open3]: http://ruby-doc.org/stdlib-2.3.0/libdoc/open3/rdoc/Open3.html
[paperclip mime]: https://github.com/thoughtbot/paperclip/issues?utf8=%E2%9C%93&q=label%3A%22Spoof%20related%20or%20Mime%20types%22%20
[file]: http://linux.die.net/man/1/file
[Down]: https://github.com/janko-m/down
[down open-uri]: https://twin.github.io/improving-open-uri/
[down streaming]: https://twin.github.io/partial-downloads-with-enumerators-and-fibers/
[shrine-carrierwave load time]: https://gist.github.com/janko-m/0d4269b9c7195b5e65cc947acf1cc028
[FileSystem]: https://github.com/janko-m/shrine/blob/master/lib/shrine/storage/file_system.rb
[S3]: https://github.com/janko-m/shrine/blob/master/lib/shrine/storage/s3.rb
[Fog]: https://github.com/janko-m/shrine-fog
[Flickr]: https://github.com/janko-m/shrine-flickr
[Cloudinary]: https://github.com/janko-m/shrine-cloudinary
[Transloadit]: https://github.com/janko-m/shrine-transloadit
[Uploadcare]: https://github.com/janko-m/shrine-uploadcare
[Imgix]: https://github.com/janko-m/shrine-imgix
[GridFS]: https://github.com/janko-m/shrine-gridfs
[SQL]: https://github.com/janko-m/shrine-sql
