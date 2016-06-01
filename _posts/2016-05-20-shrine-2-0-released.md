---
title: Shrine 2.0 Released
tags: ruby shrine file upload
---

[Shrine] is a full-featured library for handling file uploads in Ruby
applications. Main advantages of Shrine are [good design], loads of flexibility
for achieving maximum performance and best user experience for any use case, and
advanced features like backgrounding, direct uploads, logging and more.

In this post I would like show you some of the most notable improvements since
version 1.0.

## Storages & Plugins

Apart from [FileSystem] and [S3] storages that ship with Shrine, there are now
[Cloudinary], [Imgix], [Flickr], [Fog], [GridFS], [Memory], and [SQL] storages
that can be used with Shrine.

Apart from [Sequel] and [ActiveRecord] integrations that ship with Shrine,
there are now integrations for [Mongoid], [Hanami] and [Reform] as well.

Since Shrine has good abstractions, both storage classes and plugins are very
easy to write. There are even guides for [creating storages] and [creating
plugins].

## Upload options

Storages like S3 and Cloudinary support a variety of options when uploading
files. With S3 you can choose public/private, expiration, caching, while
with Cloudinary you can choose responsive breakpoints, transformations,
face detection and other.

The simplest way to set upload options is directly on the storage:

```ruby
Shrine::Storage::Cloudinary.new(
  upload_options: {
    responsive_breakpoints: {
      min_width: 200,
      max_width: 1000,
    }
  },
  **options
)
```

Shrine also ships with [upload_options] plugin which allows you to set upload
options dynamically:

```ruby
plugin :upload_options, store: ->(io, context) do
  if context[:version] == :original
    {acl: "private"} # the original file is private
  else
    {acl: "public-read"}
  end
end
```

## Metadata

With Shrine it's really easy to extract metadata of uploaded files; by default
Shrine extracts filesize, original filename and MIME type, and saves it to the
`<attachment>_data` column as JSON.

Shrine also has [determine_mime_type] plugin for determining MIME type from file
contents, and [store_dimensions] plugin for extracting image dimensions. From
Shrine 2.0 you are now able to combine built-in analyzers:

```ruby
plugin :determine_mime_type, analyzer: ->(io, analyzers) do
  analyzers[:mimemagic].call(io) || analyzers[:file].call(io)
end
```

The above first attempts to determine file's MIME type with [MimeMagic], and
falls back to the [file command].

## Download endpoint

If you're storing files in an SQL or Mongo database, or you're caching files in
the tmp/ directory because Heroku doesn't allow you to write into the public/
directory, your files won't be accessible via URL.

Or you may want that all uploaded file URLs go through your application
(regardless of where they're stored), so that you can require authentication
for those files.

To cover both scenarios Shrine now has the [download_endpoint] plugin. This
plugin provides a Rack endpoint which you can mount inside your application,
which streams uploaded files. It's even smart enough to set the
"Content-Length" response header, so that browsers can show an ETA.

```ruby
class VideoUploader < Shrine
  plugin :download_endpoint, storages: [:store], prefix: "videos"
end
```
```ruby
Rails.application.routes.draw do
  mount VideoUploader::DownloadEndpoint, to: "/videos"
end
```

If your files are stored on a remote storage like S3, the endpoint will
**stream the file as it is being downloaded**. I've tested this with a video
uploaded to S3, and through this enpdoint I could start watching it already
after 3 seconds, even though most of the video hasn't yet been downloaded from
S3.

## Backups

You may want the uploaded files to be automatically backed up. Some cloud
services have this feature built-in, but some don't. For that reason Shrine
provides a generic [backup] plugin which automatically backs up files uploaded
to the main storage, to any other Shrine storage.

```ruby
storages[:s3_backup] = Shrine::Storage::S3.new(bucket: "myapp-backup", **options)
plugin :backup, storage: :s3_backup
```

## Callbacks

Sometimes you may want to do additional actions when attachment is cached
(uploaded to temporary storage) or stored (uploaded to permanent storage).
Shrine now provides `Attacher#cached?` and `Attacher#stored?` methods which you
can use in callbacks:

```ruby
class Document < Sequel::Model
  include FileUploader[:file]

  def before_save
    super
    if column_changed?(:file_data)
      if file_attacher.cached?
        # ...
      end

      if file_attacher.stored?
        # ...
      end
    end
  end
end
```

## Testing

Shrine provides a "direct upload" feature, which allows you to asynchronously
start caching the file as soon as the user chooses it in the form. For S3
storage you can upload the file directly to Amazon, and these are called
"presigned uploads".

If you were writing acceptance tests around presigned uploads, and you wanted
files to be uploaded to FileSystem rather than S3 in order to avoid HTTP
requests in tests, you needed to create special "test" conditionals in your
application code.

As of Shrine 1.4.0, you don't need to make any additional setup when testing
presigns, using FileSystem will just work.

## Switching

If you ever decide you want to switch to Shrine from an existing file upload
library, I wrote guides for [CarrierWave], [Paperclip] and [Refile] users.
The guides explain some of the key differences in how Shrine works compared to
the other libraries, following with a detailed 1-1 mapping of features, and
complete instructions on how to migrate a production app to Shrine.

## Future

While you don't need any Shrine-specific gems to process files in Shrine, the
[image_processing] gem is a convenient collection of high-level macros for
common image processing requirements. Currently it only supports [MiniMagick],
but I would like to add support for [VIPS], and perhaps [RMagick] since it's now
[revived].

I also plan to create Shrine integrations for other on-the-fly processing
services like [FileStack] and [Uploadcare].

## Conclusion

I'mv very happy with the way Shrine is going, I think it's successfully
addressing the limitations of existing file upload libraries, and provides some
nice unique features.

[Shrine]: https://github.com/janko-m/shrine
[good design]: http://shrinerb.com/rdoc/files/doc/design_md.html
[FileSystem]: http://shrinerb.com/rdoc/classes/Shrine/Storage/FileSystem.html
[S3]: http://shrinerb.com/rdoc/classes/Shrine/Storage/S3.html
[Cloudinary]: https://github.com/janko-m/shrine-cloudinary
[Flickr]: https://github.com/janko-m/shrine-flickr
[Fog]: https://github.com/janko-m/shrine-fog
[GridFS]: https://github.com/janko-m/shrine-fog
[Imgix]: https://github.com/janko-m/shrine-imgix
[Memory]: https://github.com/janko-m/shrine-memory
[SQL]: https://github.com/janko-m/shrine-sql
[ActiveRecord]: http://shrinerb.com/rdoc/classes/Shrine/Plugins/Activerecord.html
[Sequel]: http://shrinerb.com/rdoc/classes/Shrine/Plugins/Sequel.html
[Mongoid]: https://github.com/janko-m/shrine-mongoid
[Hanami]: https://github.com/katafrakt/hanami-shrine
[Reform]: https://github.com/janko-m/shrine-reform
[upload_options]: http://shrinerb.com/rdoc/classes/Shrine/Plugins/UploadOptions.html
[determine_mime_type]: http://shrinerb.com/rdoc/classes/Shrine/Plugins/DetermineMimeType.html
[store_dimensions]: http://shrinerb.com/rdoc/classes/Shrine/Plugins/StoreDimensions.html
[MimeMagic]: https://github.com/minad/mimemagic
[file command]: http://linux.die.net/man/1/file
[download_endpoint]: http://shrinerb.com/rdoc/classes/Shrine/Plugins/DownloadEndpoint.html
[backup]: http://shrinerb.com/rdoc/classes/Shrine/Plugins/Backup.html
[creating storages]: http://shrinerb.com/rdoc/files/doc/creating_storages_md.html
[creating plugins]: http://shrinerb.com/rdoc/files/doc/creating_plugins_md.html
[CarrierWave]: http://shrinerb.com/rdoc/files/doc/carrierwave_md.html
[Paperclip]: http://shrinerb.com/rdoc/files/doc/paperclip_md.html
[Refile]: http://shrinerb.com/rdoc/files/doc/refile_md.html
[image_processing]: https://github.com/janko-m/image_processing
[MiniMagick]: https://github.com/minimagick/minimagick
[VIPS]: http://www.vips.ecs.soton.ac.uk/
[RMagick]: https://github.com/rmagick/rmagick
[revived]: http://linduxed.com/blog/2015/07/19/rmagick-a-year-later/
[FileStack]: https://www.filestack.com/
[Uploadcare]: https://uploadcare.com/
