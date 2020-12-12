---
title: "Better File Uploads with Shrine: Attachment"
tags: shrine
excerpt: "This is the 3rd part of a series of blog posts about Shrine. In this
  part I talk about Shrine's high-level interface for attaching uploaded files
  to model instances."
---

In the [previous post] I talked about the foundation of Shrine's design. In
this post I want to show you Shrine's high-level interface for attaching
uploaded files to model instances, which builds upon this foundation.

## Attachment

With most file attachment libraries, in order to create a file attachment
attribute on the model, you first extend your model with a module, and then
you use the gained class methods to create attachment attributes.

```rb
class Photo
  extend CarrierWave::Mount # done automatically by CarrierWave
  mount_uploader :image, ImageUploader
end
```

However, CarrierWave here adds a total of **5 class methods** and **24 instance
methods** to your model, which to me is a lot of pollution. Other file
attachment libraries are better in this regard, though.

Shrine takes a cleaner approach here. With Shrine you use *your uploader* to
generate an attachment module for a certain attribute, and then you `include` it
directly to your model. This is called the [module builder pattern].

```rb
class Photo
  include ImageUploader::Attachment(:image)
end
```

This way for a single attachment Shrine adds only **4 instance methods** and
**1 class method** to your model by default. [Singe table inheritance][STI]
inheritance is supported as well (Paperclip and CarrierWave don't support STI).
The included `Shrine::Attachment` module will be nicely displayed when listing
model ancestors, because it's not an anonymous module:

```rb
Photo.ancestors #=>
# [
#   Photo,
#   #<ImageUploader::Attachment(image)>,
#   Object,
#   BasicObject,
# ]
```

## Attaching

### Single column

As we talked about in the previous post, when a Shrine uploader uploads a given
file, it returns a `Shrine::UploadedFile` object. This object contains
the storage name it was uploaded to, the location, and the metadata extracted
before upload.

Shrine's attacher persists this information into a single database column, by
converting the `Shrine::UploadedFile` object into its JSON represntation.

```rb
add_column :photos, :image_data # only a single column is used for the attachment
```

Paperclip, for example, mandates [4 columns][paperclip columns] for an attached
file. Refile and Dragonfly also require [additional columns][magic attributes]
if you want to save additional file metadata. CarrierWave doesn't have native
support for additional metadata, but you can use [carrierwave-meta], though
it's ActiveRecord-specific and image-specific, and pollutes your model with all
the metadata methods.

### Temporary & permanent storage

Shrine uses a temporary and permanent storage when attaching. When a file is
assigned, it is uploaded to temporary storage, and then after validations pass
and record is saved, the cached file is reuploaded to permanent storage.

```rb
Shrine.storages = {
  cache: Shrine::Storage::FileSystem.new("public", prefix: "cache"), # temporary
  store: Shrine::Storage::FileSystem.new("public", prefix: "store"), # permanent
}
```
```rb
photo = Photo.new

photo.image = file  # Saves the file to temporary storage
photo.image_data #=> '{"storage":"cache","id":"ds9ga94.jpg","metadata":{...}}'

photo.save  # Promotes the file from temporary to permanent storage
photo.image_data #=> '{"storage":"store","id":"l0fgla8.jpg","metadata":{...}}'

photo.image #=> #<Shrine::UploadedFile>
```

This separation of temporary and permanent storage enables features like
retaining the uploaded file in case of validation errors, [direct uploads] and
[backgrounding], without the possibility of having orphan files in your main
storage.

### Presence

While CarrierWave and Paperclip provide `#present?` and `#blank?` methods to
check whether a file is attached, Shrine will simply return `nil` if there is
no file attached.

```rb
photo.image # returns either `Shrine::UploadedFile` or `nil`
```

### Location

When attaching an uploaded file, CarrierWave and Paperclip store only the
filename to the database column, and the full location to the file is generated
dynamically from your configured directory.

This is not a good design decision, because it makes it very difficult to
migrate files to a new directory. If you try to first change the directory
option to a new directory, all URLs for the existing files will now point at
the wrong location, because those files are still in the old location. If you
however try to first move files themselves, the URLs would again start pointing
to the wrong location, because files are now located at the new location.

```rb
class ImageUploader < CarrierWave::Uploader::Base
  def store_dir
    "#{model.name.downcase}/#{model.id}"
  end
end
```
```rb
# Only the filename is saved, the path is always dynamically generated
photo.attributes[:image] #=> "nature.jpg"
```

Shrine learns from this mistake, and instead saves the whole generated path to
the attachment column. And if you *change* how the location is generated, all
existing files will still remain fully accessible, because their location is
still read directly from the column. Then later you can [move them
manually][shrine moving files] if you want.

```rb
class ImageUploader < Shrine
  plugin :pretty_location
end
```
```rb
# Shrine saves the full path to the file
photo.attributes[:image_data] #=> '{"id":"photo/45/image/d0sg8fglf.jpg",...}'
```

## ORM integration

To use Shrine with an ORM, you just need to load the ORM plugin, which will
automatically add callbacks and validations when an attachment module is
included.

```rb
Shrine.plugin :sequel # :activerecord
```

[Shrine's ORM implementation][shrine activerecord] is much simpler than
[CarrierWave's][carrierwave activerecord], which means that writing new ORM
integrations is also simpler. One reason for this simplicity is that Shrine
properly utilizes dirty tracking by writing the cached file to the attachment
column on assignment, while most other file attachment libraries have to add
[\<attribute\>_will_change! hacks] everywhere where the attachment could
change, so that callbacks are always invoked.

Shrine ships with plugins for [Sequel] and ActiveRecord, but there are also
external plugins for [Mongoid][shrine-mongoid] and
[Hanami::Model][hanami-shrine]. A [ROM][shrine-rom] plugin is also in the
making.

## Attacher

The model interface provided by the `Shrine::Attachment` module is just a thin
wrapper around a `Shrine::Attacher` object (inspired by Refile), which you can
also use directly:

```rb
attacher = ImageUploader::Attacher.from_model(photo, :image)

attacher.assign(file) # equivalent to `photo.image = file`
attacher.get          # equivalent to `photo.image`
attacher.url          # equivalent to `photo.image_url`
```

So if you prefer not to add any additional methods to your model, and prefer
explicitness over callbacks, you can simply use `Shrine::Attacher` directly
without including the attachment module to your model. See the [Using Attacher]
guide for more examples.

## Validations

Shrine supports validating attached files, and ships with a
`validation_helpers` plugin which provides methods for common file validations.

```rb
class ImageUploader < Shrine
  plugin :validation_helpers

  Attacher.validate do
    validate_mime_type %w[image/jpeg image/png image/webp]
    validate_extension %w[jpg jpeg png webp]

    validate_max_size 10*1024*1024 # 10 MB

    validate_max_dimensions [5000, 5000]
  end
end
```

Inspired by [Sequel validations], Shrine validations are performed at the
*instance level* (as opposed to using a class-level DSL), which means that you
can use regular Ruby conditionals and do custom file validation. For example,
you could validate maximum duration of a video:

```rb
class VideoUploader < Shrine
  Attacher.validate do
    if file.duration > 5*60*60
      errors << "must not be longer than 5 hours"
    end
  end
end
```

## Conclusion

We learned about two new Shrine core classes. One is `Shrine::Attachment`, a
subclass of `Module`, which can generate attachment modules for adding file
attachment attributes to your models. The other one is `Shrine::Attacher`,
which is in charge of the actual file attachment logic, and can be used
directly.

Combined with `Shrine` and `Shrine::UploadedFile`, these are the 4 core classes
of Shrine. In future posts I will talk about all the advanced features that are
possible with these core classes. The next post will be about file processing
with Shrine, so stay tuned!

[Shrine]: https://github.com/shrinerb/shrine
[previous post]: https://twin.github.io/better-file-uploads-with-shrine-uploader/
[CarrierWave::Mount]: https://github.com/carrierwaveuploader/carrierwave/blob/1dbc8be0bb8cf3b48600c5451084ee13445747b0/lib/carrierwave/mount.rb
[paperclip columns]: https://github.com/thoughtbot/paperclip/blob/7edb35a2a9a80c9598dfde235c7e593c023fc914/lib/paperclip/schema.rb#L6-L9
[magic attributes]: http://markevans.github.io/dragonfly/models#magic-attributes
[carrierwave-meta]: https://github.com/gzigzigzeo/carrierwave-meta/
[Sequel]: https://github.com/jeremyevans/sequel
[shrine-mongoid]: https://github.com/shrinerb/shrine-mongoid
[hanami-shrine]: https://github.com/katafrakt/hanami-shrine
[shrine-rom]: https://github.com/shrinerb/shrine-rom-example/blob/30ff892216d18ee2b64a1b784a06e489bb3be75d/config/shrine-rom.rb
[shrine activerecord]: https://github.com/shrinerb/shrine/blob/master/lib/shrine/plugins/activerecord.rb
[carrierwave activerecord]: https://github.com/carrierwaveuploader/carrierwave/blob/master/lib/carrierwave/orm/activerecord.rb
[<attribute>_will_change! hacks]: https://github.com/carrierwaveuploader/carrierwave/blob/1dbc8be0bb8cf3b48600c5451084ee13445747b0/lib/carrierwave/orm/activerecord.rb#L67
[shrine moving files]: https://shrinerb.com/docs/changing-location
[STI]: http://api.rubyonrails.org/classes/ActiveRecord/Inheritance.html
[Using Attacher]: https://shrinerb.com/docs/attacher
[Sequel validations]: http://sequel.jeremyevans.net/rdoc-plugins/classes/Sequel/Plugins/ValidationHelpers.html
[direct uploads]: https://shrinerb.com/docs/getting-started#direct-uploads
[backgrounding]: https://shrinerb.com/docs/getting-started#backgrounding
[module builder pattern]: https://dejimata.com/2017/5/20/the-ruby-module-builder-pattern
