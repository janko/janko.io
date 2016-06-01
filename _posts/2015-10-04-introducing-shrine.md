---
title: Introducing Shrine – A file upload toolkit
tags: ruby web file upload
---

I'm really excited about this. I've just released [Shrine], a new solution for
handling file uploads in Ruby applications. It was heavily inspired by Refile,
most notably its idea of backends. However, unlike Refile, it is designed
primarily for upfront processing (as opposed to on-the-fly). It's also inspired
by CarrierWave's idea of uploaders.

## Flexibility

Shrine implements a [plugin system] analogous to [Roda]'s and [Sequel]'s. It
has a small core which provides only the essential functionality, while other
features come as plugins which can be loaded when needed. Shrine ships with
[over 25 plugins], which together provide a great arsenal of features.

This design makes Shrine extremely versatile. File uploads are very delicate,
and need to be handled differently depending on what types of files are being
uploaded, whether there is processing or not, what storage is used etc.
Instead of having an opinion on how you want to do your upload, Shrine allows
you to build an uploading flow that suits your needs.

```ruby
class ImageUploader < Shrine
  plugin :sequel
  plugin :pretty_location
  plugin :logging, format: :json
end
```
```ruby
class User < Sequel::Model
  include ImageUploader[:avatar] # creates and includes an attachment module
end
```
```ruby
user = User.create(avatar: File.open("path/to/avatar.jpg"))
user.avatar.id # "user/532/avatar/f753g598sm3l2.jpg"
```

## Simplicity

Where CarrierWave and other file upload libraries favor complex class-level
DSLs, Shrine favours simple instance-level interface. Here's an example on how
file processing is done in Shrine:

```ruby
require "image_processing/mini_magick" # part of the "image_processing" gem

class ImageUploader < Shrine
  include ImageProcessing::MiniMagick
  plugin :versions, names: [:small, :medium, :large]

  def process(io, context)
    return if context[:record].guest? # we have access to the record
    if context[:phase] == :store
      size_800 = io.download                         #
      size_500 = resize_to_limit(size_800, 500, 500) # instances of Tempfile
      size_300 = resize_to_limit(size_500, 300, 300) #

      {large: size_800, medium: size_500, small: size_300}
    end
  end
end
```

This method gets called whenever a file is uploaded, so you can just use regular
Ruby to specify exactly how and when processing is done. You can also choose
to do some processing on caching as well.

Validations are done in a similar fashion:

```ruby
class ImageUploader < Shrine
  plugin :validation_helpers

  Attacher.validate do
    # Evaluated inside an instance of Shrine::Attacher.
    unless record.admin?
      validate_max_size 2*1024*1024, message: "is too large (max is 2 MB)"
      validate_mime_type_inclusion ["image/jpg", "image/png", "image/gif"]
    end
  end
end
```

Another difference from other gems is number of obligatory dependencies.  While
CarrierWave, Refile and Paperlip have 9-12 depedencies in total, Shrine by
default has only 1 small dependency for downloading files.

## Performance

Shrine cares a lot about performance. For example, it allows you to minimize
file copying by moving files instead, which is useful when dealing with larger
files, and also means that no temporary files will be left behind.

Shrine also comes with a `parallelize` plugin, which uploads and deletes files
in parallel. This is used when you have multiple versions of your files.

### Background jobs

Now we come to a major difference between Shrine and other uploading gems.
Other gems aren't designed to support backgrounding, and although external gems
exist that add this functionality (e.g. [carrierwave_backgrounder]), they
require complex setup and in my experience have been very unstable (e.g.
carrierwave_backgrounder breaks removing attachments).

Shrine, on the other hand, embraces that putting phases of file upload into
background jobs is essential for good user experience and scaling, and is
designed from the very beginning with this in mind. It comes with a
`backgrounding` plugin, which allows you to put processing, storing and
deleting into a background job:

```ruby
Shrine.plugin :backgrounding
Shrine::Attacher.promote { |data| UploadJob.perform_async(data) }
Shrine::Attacher.delete { |data| DeleteJob.perform_async(data) }
```
```ruby
class UploadJob
  include Sidekiq::Worker
  def perform(data)
    Shrine::Attacher.promote(data)
  end
end
```
```ruby
class DeleteJob
  include Sidekiq::Worker
  def perform(data)
    Shrine::Attacher.delete(data)
  end
end
```

Notice that, unlike gems like carrierwave_backgrounder, you are required to
write your own job classes, but as you can see, Shrine makes the implementation
very simple. In this example I used Sidekiq, but obviously you can just as well
use any other backgrounding library.

The end user experience was the main guidance in Shrine's design. Before the
file is moved to store, the record is first saved with the cached version of
the file. This means that, while the file is being processed and stored in the
background, the end user will immediately see the image they uploaded, because
the URL will point to the cached version. So from the user's perspective, at
this moment the file upload is finished!

```ruby
user.avatar.url #=> "/uploads/dso3432kdw032.jpg"
# ... Background job is done storing ...
user.avatar.url #=> "https://s3-sa-east-1.amazonaws.com/my-bucket/0943sf8gfk13.jpg"
```

When the background job finishes, the record will be updated with the stored
version, but the user won't notice that the URL has changed, because they
will still see the same image. And this is the goal, to make the end user
completely unaware of the internal complexity.

### Direct uploads

Like Refile, Shrine also supports direct uploads. This means you can cache
files using AJAX, before the form is submitted. This generally provides the best
user experience, because the UI isn't blocked, and the user knows how much
they have to wait (assuming you give them a progress bar). The endpoint for
direct uploads is provided by the `direct_upload` plugin.

```ruby
class ImageUploader < Shrine
  plugin :direct_upload
end
```
```ruby
Rails.application.routes.draw do
  # adds `POST /attachments/images/:storage/:name`
  mount ImageUploader.direct_endpoint => "/attachments/images"
end
```

Unlike Refile, Shrine doesn't ship with complete JavaScript which makes this
just work, instead it expects you to use an existing JavaScript library for
file uploads ([jQuery-File-Upload] is really good). This plugin also provides a
presign route which you can use for implementing direct S3 uploads. I created
an [example app] to demonstrate how easy it is to implement multiple uploads
directly to S3.

## Safety

File uploads can bring many security vulnerabilities, and Shrine tries to be as
secure as possible.

For example, for extracting image dimensions it uses the [fastimage] gem, which
has built-in protection against [image bombs]. Shrine also ships with the
`determine_mime_type` plugin which enables you to extract the actual MIME type
of a file (by default it uses the UNIX [file] utility).

Shrine normally does processing before storing, which happens after validation
(I say "normally" because you can also choose to process on caching, depending
on your situation). I mention this because CarrierWave does processing *before*
validation, which is a huge security flaw since it allows attackers to easily
DoS your application by uploading large images ([#1320]).

Shrine also implements `backgrounding` in a very safe way. For example, it
could potentially happen that the user changes the attachment before the
background job is finished processing and storing. In this situation a naive
implementation would replace a new file with an old stored one, but Shrine,
once it's done with processing and storing, checks if the attachment has
changed, and if it did it doesn't do the replacement.

## Conclusion

Shrine ships with [a lot of other plugins] that I haven't managed to cover here,
but I encourage you to check them out. I spent a lot of time studying other
solutions and their open issues, and hopefully I succeeded in making Shrine the
next level of file uploads.

[Shrine]: https://github.com/janko-m/shrine
[plugin system]: http://twin.github.io/the-plugin-system-of-sequel-and-roda/
[Roda]: https://github.com/jeremyevans/roda
[Sequel]: https://github.com/jeremyevans/sequel
[over 25 plugins]: http://shrinerb.com#plugins
[a lot of other plugins]: http://shrinerb.com#plugins
[carrierwave_backgrounder]: https://github.com/lardawge/carrierwave_backgrounder
[jQuery-File-Upload]: https://github.com/blueimp/jQuery-File-Upload
[example app]: https://github.com/janko-m/shrine-example
[fastimage]: https://github.com/sdsykes/fastimage
[image bombs]: https://www.bamsoftware.com/hacks/deflate.html
[#1320]: https://github.com/carrierwaveuploader/carrierwave/issues/1320
[file]: http://linux.die.net/man/1/file
