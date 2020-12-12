---
title: "Better File Uploads with Shrine: Metadata"
tags: shrine
excerpt: "This is the 5th part of a series of blog posts about Shrine. In this
  part I talk about how Shrine extracts and stores file metadata."
updated: 15.9.2019.
---

Shrine has very flexible and customizable support for saving file metadata.
Whenever Shrine is about to upload a file, it extracts available metadata from
the file, and adds it to the returned `Shrine::UploadedFile` object.

```rb
uploaded_file = uploader.upload(file)
uploaded_file #=> #<Shrine::UploadedFile>

uploaded_file.metadata #=>
# {
#   "filename" => "nature.jpg",
#   "mime_type" => "image/jpeg",
#   "size" => 2859343
# }

uploaded_file.original_filename #=> "nature.jpg"
uploaded_file.extension         #=> "jpg"
uploaded_file.mime_type         #=> "image/jpeg"
uploaded_file.size              #=> 2859343
```

Most file attachments libraries have support for saving file metadata into
additional columns. However, that means that you need to have a database column
for each metadata you want to save.

```rb
# This is lame
add_column :photos, :image_filename, :string
add_column :photos, :image_type,     :string
add_column :photos, :image_size,     :integer
add_column :photos, :image_width,    :integer
add_column :photos, :image_height,   :integer
# ...
```

Shrine takes a much simpler approach here. Since it uses a single
`<attachment>_data` database column to save the serialized
`Shrine::UploadedFile` object, any metadata included in this object will also
get saved to the same column.

```rb
photo = Photo.create(image: file)
photo.image_data #=>
# {
#   "id": "ee08af.jpg",
#   "storage": "store",
#   "metadata": {
#     "filename" => "nature.jpg",
#     "mime_type" => "image/jpeg",
#     "size" => 2859343
#   }
# }
```

Furthermore, when you're storing processed files alongside the main file,
Shrine automatically extracts and saves metadata of each file:

```rb
class ImageUploader < Shrine
  plugin :derivatives

  Attacher.derivatives_processor do |original|
    magick = ImageProcessing::MiniMagick.source(original)

    {
      small:  magick.resize_to_limit!(300, 300),
      medium: magick.resize_to_limit!(500, 500),
      large:  magick.resize_to_limit!(800, 800),
    }
  end
end
```
```rb
photo.image_derivatives!
photo.image_data
# {
#   "id": "ee08af.jpg",
#   "storage": "store",
#   "metadata": { ... },
#   "derivatives": {
#     "small": { "id": "f9f67a.jpg", "storage": "store", "metadata": { ... } },
#     "medium": { "id": "5e27cf.jpg", "storage": "store", "metadata": { ... } },
#     "large": { "id": "ff1da8.jpg", "storage": "store", "metadata": { ... } },
#   }
# }

photo.image(:small).size  #=> 21496
photo.image(:medium).size #=> 98237
photo.image(:large).size  #=> 150383
```

## MIME type

Shrine doesn't have any mandatory dependency for extracting MIME type, so by
default it is inherited from `#content_type` of the input file if available.
However, this attribute on uploaded files is set by Rack from the
`Content-Type` request header, which was set by the browser solely based on the
file extension.

This means that by default Shrine's `mime_type` metadata is not guaranteed to
hold the actual MIME type of the file (e.g. the user can upload a PHP file with
a .jpg extension). This might sound like Shrine is not secure by deafult, but
you do get a warning in the console when `#content_type` is used. And in some
scenarios this might be exactly what you want.

Shrine comes with a `determine_mime_type` plugin, which determines MIME type
from file *content*. It uses tools that know how to read "magic headers" of
files, and saves the result into `mime_type` (which can then be
[validated][validation]).

```rb
# Gemfile
gem "marcel"
```
```rb
Shrine.plugin :determine_mime_type, analyzer: :marcel
```
```rb
File.write("image.png", "<?php ... ?>") # PHP file with a .png extension
uploaded_file = uploader.upload(File.open("image.png"))
uploaded_file.mime_type #=> "text/x-php"
```

If the `:marcel` analyzer doesn't suit you, you can choose a different
analyzer, or even combine them:

```rb
Shrine.plugin :determine_mime_type, analyzer: -> (io, analyzers) do
  analyzers[:mimemagic].call(io) || analyzers[:file].call(io)
end
```

## Image Dimensions

Image dimensions can be extracted by loading the `store_dimensions` plugin:

```rb
# Gemfile
gem "fastimage" # default analyzer
```
```rb
class ImageUploader < Shrine
  plugin :store_dimensions
end
```
```rb
image = image_uploader.upload(file)
image.metadata #=>
# {
#   "filename" => "nature.jpg",
#   "mime_type" => "image/jpeg",
#   "size" => 90423,
#   "width" => 500,
#   "height" => 400,
# }

image.width  #=> 500
image.height #=> 400

image.dimensions #=> [500, 400]
```

## Custom metadata

In addition to built-in metadata, Shrine allows you to easily extract and save
*custom* metadata, with the `add_metadata` plugin.

```rb
class DocumentUploader < Shrine
  plugin :add_metadata

  add_metadata :pages do |io|
    PDF::Reader.new(io.path).page_count
  end
end
```
```rb
pdf = document_uploader.upload(cv)
pdf.metadata #=>
# {
#   "filename" => "curriculum-vitae.pdf",
#   "mime_type" => "application/pdf",
#   "size" => 49234,
#   "pages" => 5
# }
pdf.pages #=> 5
```

Notice that it also generated a `#pages` reader method on the
`Shrine::UploadedFile` object. I think it's nice to be able to extend Shrine
objects with methods that fit your domain.

If you're using a tool which extracts multiple metadata at once, the
`add_metadata` plugin supports returning a hash as well.

```rb
class VideoUploader < Shrine
  plugin :add_metadata

  add_metadata do |io|
    movie = FFMPEG::Movie.new(io.path)

    { "duration"   => movie.duration,
      "bitrate"    => movie.bitrate,
      "resolution" => movie.resolution,
      "frame_rate" => movie.frame_rate }
  end

  metadata_method :duration, :bitrate, :resolution, :frame_rate
end
```
```rb
video = video_uploader.upload(file)

video.duration   #=> 7.5
video.bitrate    #=> 481
video.resolution #=> "640x480"
video.frame_rate #=> 16.72
```

## Storage metadata

In addition to extracting the metadata on your side, Shrine also gives the
storage itself the ability to update the metadata after uploading. Some
storages like filesystem and Amazon S3 won't use this, but many other storage
services extract file metadata during uploading.

For example, when you're uploading images to Cloudinary, [shrine-cloudinary]
will [automatically update][cloudinary metadata] `size`, `mime_type`, `width`
and `height` metadata values. This is especially useful if you're processing
the image on upload with Cloudinary, because then the metadata that Shrine
extracted won't match the uploaded file, since those were extracted before the
upload.

```rb
uploaded_file = cloudinary_uploader.upload(image, upload_options: {
  format: "png",
  width:  800,
  height: 800,
  crop:   :limit,
})

uploaded_file.metadata #=>
# {
#   "filename" => "nature.jpg"
#   "mime_type" => "image/png",
#   "size" => 8584,
#   "width" => 800,
#   "height" => 600,
# }
```

Cloudinary also has the ability to automatically generate [responsive
breakpoints], and the ability to update the metadata allows the storage to
store the information about the generated breakpoints.

```rb
uploaded_file = cloudinary_uploader.upload(image, upload_options: {
  responsive_breakpoints: {
    bytes_step: 20000,
    min_width: 200,
    max_width: 1000,
    max_images: 20,
  }
})

uploaded_file.metadata["cloudinary"]["responsive_breakpoints"] #=>
# [{
#   "breakpoints": {
#     {
#       "width": 1000,
#       "height": 667,
#       "bytes": 79821,
#       "url": "http://res.cloudinary.com/demo/image/upload/c_scale,w_1000/v1453637947/dog.jpg",
#       "secure_url": "https://res.cloudinary.com/demo/image/upload/c_scale,w_1000/v1453637947/dog.jpg"
#     },
#     ...
#   }
# }]
```

Some other storages that use the ability to update metadata include
[shrine-flickr], [shrine-transloadit] and [shrine-uploadcare].

## Summary

We've seen how Shrine automatically extracts metadata before upload, which is
then stored into the same database column. You can determine MIME type and
extract image dimensions from file content using a variety of tools, just by
loading a corresponding plugin. You can also extract any custom metadata, and
storage services can add their own metadata as well.

[Shrine]: https://github.com/shrinerb/shrine
[versions]: https://github.com/shrinerb/shrine#versions
[Fastimage]: https://github.com/sdsykes/fastimage
[image bombs]: https://www.bamsoftware.com/hacks/deflate.html
[responsive breakpoints]: http://cloudinary.com/blog/introducing_intelligent_responsive_image_breakpoints_solutions
[shrine-cloudinary]: https://github.com/shrinerb/shrine-cloudinary
[cloudinary metadata]: https://github.com/shrinerb/shrine-cloudinary/blob/c899875b935a45bc322a5e18be9c2132ebeecb4d/lib/shrine/storage/cloudinary.rb#L152-L157
[shrine-transloadit]: https://github.com/shrinerb/shrine-transloadit/blob/cd3b57aeeae3587852e2bab5f311b8f713f72fe5/lib/shrine/plugins/transloadit.rb#L150-L157
[shrine-flickr]: https://github.com/shrinerb/shrine-flickr/blob/e0226bc4d2a316924d4690e5f0c1c21f613e44c1/lib/shrine/storage/flickr.rb#L114
[shrine-uploadcare]: https://github.com/shrinerb/shrine-uploadcare/blob/c167516ba3002f7c880bfdea2e349731e7a7dddd/lib/shrine/storage/uploadcare.rb#L156-L165
[validation]: https://github.com/shrinerb/shrine#validation
