---
title: "Better File Uploads with Shrine: Motivation"
tags: shrine
excerpt: "This is the 1st part of a series of blog posts about Shrine. In this
  part I talk about the motivation behind creating Shrine, by going over the
  limitations of existing file attachment libraries."
comments: disqus
---

It's been over a year since I started working on [Shrine], and during that time
Shrine has acquired a lot of cool features, the ecosystem has grown
significantly, and many people are already using Shrine in production.

Before I go in depth explaining all the cool things that you can do with
Shrine, I thought it would be good to take a step back, and first explain what
was my motivation to create Shrine in the first place.

Specifically, I want to talk about limitations of existing file attachment
libraries. I think it's important to be aware of these limitations, so that you
can make a choice which [best meets your requirements][evaluating libraries].

## Requirements

My requirements were the following:

1. files should be uploaded directly to Amazon S3
1. processing and deleting files should happen in a background job
1. processing can happen on upload or on-the-fly
1. has to integrate with the [Sequel] ORM
1. has to work in a web framework which isn't Rails

In my opinion the first two requirements should be very common, because that
way you achieve the best performance and user experience, but the last two also
shouldn't be unusual:

1\. Uploading files directly to Amazon S3 or another storage service frees your
application from accepting file uploads. This has several benefits: your
server uses less resources, works with multiple servers which don't share the
filesystem, works with Heroku and other hosting services which [don't allow
saving to disk] or have a [30-second request timeout].

2\. Offloading processing and deleting files to background jobs enables
managing file attachments to be [completely asynchronous][asynchronous
uploads], regardless of whether you're storing on the local filesystem or to an
external storage service like Amazon S3, which significantly improves the user
experience because there is no waiting. Using background jobs is also necessary
for maintaining high throughput of your application, because your request
instances won't be tied waiting for slow tasks.

3\. Doing processing on-the-fly can really work great for small files like
images, especially if you want to generate many sizes for different pages or
devices. On the other hand, processing on upload is still necessary for videos
or other large files. Therefore, I want my file attachment library to allow
both, so that I can use it for any type of files.

4\. Using the Sequel ORM also makes a lot of sense, because Sequel is
objectively a better ORM than ActiveRecord (see why [Sequel ≻ ActiveRecord],
and why [ActiveRecord ⊁ Sequel]). If a Sequel integration for the file
attachment library doesn't exist, it should at least be straightforward to
write one.

5\. Finally, there are many reasons for using other web frameworks than Rails.
For example, [Roda] has [really advanced routing][roda's routing], and routing
is coincidentally the most important part of a web framework (all other parts
are interchangable). So I need the file attachment library to be easy to use
in any web framework.

Now I want walk through existing file attachment libraries, and explain what
were the major limitations for me, with a focus on the above requirements.

## Paperclip

> Easy file attachment management for **ActiveRecord**

Ok, it looks like we can immediately say goodbye to using [Paperclip] with
Sequel. But let's continue going through other requirements, since the majority
of you are using ActiveRecord anyway.

### Direct uploads

Paperclip doesn't have a solution for handling direct S3 uploads. We could
still use [aws-sdk] to generate URL and parameters for direct upload to S3, and
then update Paperclip columns directly, in the same way that Paperclip would
update them if we uploaded the file through Paperclip.

However, since Paperclip has only one main storage, for this to work the direct
uploads should go directly to your main S3 storage. And that's a security
problem, because an attacker can upload many files without attaching them, and
then you have many orphan files on S3 which will be difficult to find and
delete if your app receives a lot of traffic. It would be much easier if you
could just [have S3 do it for you][S3 object lifecycle].

### Backgrounding

For processing in backgrounding there is [delayed_paperclip]. However,
[delayed_paperclip] will spawn a background job only after the file is
uploaded. This means that if you don't want or can't do direct S3 uploads, your
users have to wait for the file to be uploaded *twice* (first to the app, then
to the storage), before any backgrounding even takes place. And that is really
slow.

Furthermore, delayed_paperclip doesn't support *deleting* files in the
background. This is a big disadvantage if you have multiple versions stored on
S3, because that's one HTTP request per version. No, wait, *two* HTTP requests
per version, because [Paperclip also checks whether each version exists before
deleting][Paperclip deleting]. Sure, you could disable file deletions, but then
you have the same problem with orphan files.

Finally [delayed_paperclip is now tied to ActiveJob], which means that you
cannot use it with a backgrounding libary directly, and that's exactly what I
want to do in non-Rails projects.

### MIME type spoofing

Paperclip has the feature to detect whether someone is trying to spoof the MIME
type of the file, e.g. if someone tries to upload a PHP file with a .jpg
extension. However, this feature is known for [many false positives][Paperclip
spoofing], meaning it can raise a validation error even when file extension
matches the content of the file. This is a dealbreaker for me, because in that
case there is no way for the user to correct their input.

I *could* disable this feature, but I don't want to leave my app vulnerable to
[basic file upload attacks][OWASP Content-Type].

## CarrierWave

> Classier solution for file uploads for Rails, Sinatra and other Ruby web frameworks

[CarrierWave] was an answer to Paperclip's hash configuration in the models, and
introduced better encapsulation via uploader classes.

CarrierWave does have a [Sequel integration][carrierwave-sequel], which was a
big improvement for me. Unfortunately, [carrierwave_backgrounder] and
[carrierwave_direct], the CarrierWave extensions that I wanted to use, both
didn't manage to rely only on CarrierWave's ORM integration, and needed a lot
of additional ActiveRecord-specific code to achieve their functionality. I know
ActiveRecord is the most popular ORM, but people do use other ORMs for various
reasons, and this pretty-much paints them into a corner.

### Direct uploads

As mentioned above, the CarrierWave ecosystem has a solution for direct S3
uploads – [carrierwave_direct]. It works in a way that it allows you to generate
a form for direct S3 upload, and then assign the S3 key of the uploaded file
to your uploader.

```erb
<!-- Form submits to "https://my-bucket.s3-eu-west-1.amazonaws.com" -->
<%= direct_upload_form_for @photo.image do |f| %>
  <%= f.file_field :image %>
  <%= f.submit %>
<% end %>
```

However, what if you need to do multiple uploads directly to S3? The README
notes that carrierwave_direct is only for single uploads. Also, what about JSON
APIs? This form isn't magical, all it does is generates URL and parameters for
the upload to S3, so why doesn't carrierwave_direct allow retrieving this
information in JSON format?

What if carrierwave_direct, instead of reimplementing the whole logic of
generating S3 request parameters using [fog-aws], simply relied on [aws-sdk]?

```rb
# aws-sdk
bucket  = s3.bucket("my-bucket")
object  = bucket.object(SecureRandom.hex)
presign = object.presigned_post
```
```erb
<!-- HTML version -->
<form action="<%= presign.url %>" method="post" enctype="multipart/form-data">
  <input type="file" name="file">
  <% presign.fields.each do |name, value| %>
    <input type="hidden" name="<%= name %>" value="<%= value %>">
  <% end %>
  <input type="submit" value="Upload">
</form>
```
```rb
# JSON version
{ "url": presign.url, "fields": presign.fields }
```

This way has the following advantages: it's not Rails-specific, it works with
JSON APIs, it **supports multiple file uploads** (the client can just make a
request for this data for each file), and it's more reliable (since now the
presign is generated by a well-maintained gem).

### Backgrounding

Firstly, it's worth noting that carrierwave_direct provides instructions how to
set up background processing. However, [setting up backgrounding reliably is a
very complicated task][asynchronous uploads], it makes much more sense to rely
on a library that does it for you.

Which brings us to [carrierwave_backgrounder]. This library supports background
processing, but in my experience it has been unreliable
([1][carrierwave_backgrounder#169], then [2][carrierwave_backgrounder#186]).
Also, it doesn't support deleting files in the background, which is a
dealbreaker if I have multiple versions stored on S3.

Even if we get past all that, how do you integrate carrierwave_backgrounder
with carrierwave_direct? As I mentioned, I want to upload files directly to S3
AND have processing and deleting done in a background job. But it seems like
these two libraries aren't compatible with each other, which means that I
cannot achieve the desired performance with CarrierWave for the most common use
case.

### Closing unresolved issues

I'm aware that being an open source maintainer of a popular library can be an
ungrateful task, and that we should always be nice to each other.
[However][carrierwave#1064], [I][carrierwave#1349] [can't][carrierwave#1773]
[understand][carrierwave#1756] [why][carrierwave#1747] [do][carrierwave#1734]
[CarrierWave][carrierwave#1711] [maintainers][carrierwave#1680]
[close][carrierwave#1555] [unresolved][carrierwave#1543]
[issues][carrierwave#1320]. It seems that bug reports are likely closed if (a)
the bug report isn't a PR or (b) the maintainers aren't sure if it's a bug.
Neither of these two are valid reasons to close an issue.

[One][carrierwave#1320] of these closed issues is about CarrierWave performing
processing before validations. This is a huge security issue, because it means
that attackers are able to give *any* file to your image processing tool, since
any filesize/MIME/dimensions validations will be performed only after
processing. That makes your app wide open to attacks like [ImageTragick],
[image bombs], or just large image uploads.

## Refile

> Ruby file uploads, take 3

[Refile] was created by Jonas Nicklas, the author of CarrierWave, as a [3rd
attempt at solving file uploads in Ruby][refile post]. Like Dragonfly, Refile
is designed for on-the-fly processing. Having had enough of CarrierWave's
complexity, I found Refile's simple and modern design really promising, so I
started contributing to it, and eventually I was invited to the core by Jonas.

```rb
Refile.attachment_url(@photo, :image, :fit, 400, 500) # resize to 400x500
#=> "/attachments/15058dc712/store/fit/400/500/ed3153b9cb"
```

Some of Refile's awesome new ideas include: temporary and permanent storage as
first-class citizens, clean storage abstraction, the IO abstraction, clean
internal design (no god objects), and built-in direct uploads (even to S3). Due
to Refile's clean design, creating a [Sequel integration][refile-sequel] was
pretty straightforward.

### Direct uploads

Refile is the first file attachment library that came with built-in support for
direct uploads, allowing you to asynchronously start uploading the attached
file the moment the user selects it. You can either upload the file to Refile's
Rack app, or directly to S3 using Refile's app to generate the S3 request
parameters. It even comes with [plug-and-play JavaScript][refile javascript]
which does everything for you.

```erb
<%= form.attachment_field :image, presigned: true %>
```

There is also one cool performance improvement here. When you're uploading the
file directly to S3, you're uploading to a bucket/directory which you marked as
"temporary". Then when the validations pass and record is saved, the uploaded
file is moved to "permanent" storage. However, if both temporary and permanent
storage are on S3, instead of downloading and reuploading, Refile will simply
issue an S3 COPY request.

Needless to say, my requirement for direct uploads was satisfied. :ok_hand:

### Backgrounding

One limitation of Refile is that it doesn't have support for background jobs.
You might think that, since Refile performs processing on-the-fly, and it has
the S3 COPY optimization, that a background job isn't needed here.

However, the S3 COPY request is still an HTTP request and impacts the duration
of the form submission. Furthermore, the speed of the S3 COPY request depends
on the filesize, so the larger the file is, the slower the S3 COPY request will
be.

Also, Amazon S3 is just one of the many cloud storage services out there, you
might wish to use a different service which better suits your needs, but which
doesn't have this optimization or even support direct uploads.

### Processing

I think on-the-fly processing works great for images that are stored locally
and are fast to process. However, if you storing originals on S3, then Refile's
app will serve the initial request to a version much slower, since it needs to
first download the original from S3. In that case you should already think
about adding a background job which preprocesses all versions by hitting their
URLs after upload.

If you're uploading larger files like videos, then it's usually better to
process them on upload instead of on-the-fly. But Refile currently doesn't
support that.

## Dragonfly

> A Ruby gem for on-the-fly processing - suitable for image uploading in Rails, Sinatra and much more!

[Dragonfly] is another solution for on-the-fly processing, which has been on the
scene much longer than Refile, and in my opinion has much more advanced and
flexible on-the-fly processing abilities.

Dragonfly doesn't have a Sequel integration, but that was to be expected and I
would be prepared to write one, but the [generic model-related
behaviour][dragonfly model] seems to be mixed with [behaviour specific to
ActiveRecord models][dragonfly activerecord], so it's not clear to me how to do
that.

There is also no support for background jobs, nor for direct uploads. You could
do the latter manually, but it would have the same downsides as for Paperclip.

But I want you to notice something very important. Retrieving files via an
image server (Dragonfly's on-the-fly processing app) is a **completely separate
responsibility** than uploading. What I mean is that you can use another file
attachment library which comes with everything (direct uploads, backgrounding,
various ORMs etc.) to upload the files to a storage, and still use Dragonfly
for serving these files.

```rb
map "/attachments" do
  run Dragonfly.app # doesn't care how the files were uploaded
end
```

## Attache

> Yet another approach to file upload

[Attache] is a relatively new file upload library, also for on-the-fly
processing. The difference between Dragonfly and Refile is that it was designed
to be run as a separate service, so files are both uploaded and served through
the Attache server.

Attache includes an [ActiveRecord integration][attache activerecord] for
attaching the uploaded files to database records, and has support for direct
uploads. But I'm still missing the ability to put [backing up][attache backup]
and deleting files into a background job. And also I would like to have the
flexibility to process files on upload as well.

Note that, as I already explained with Dragonfly, Attache doesn't need to bring
its own model integration – people can just use Shrine for that. This year I
went to RedDotRubyConf in Singapore, where I happened to meet the author of
Attache, and after a very fun discussion about how complicated file uploads
are, we agreed that it would be beneficial to use Shrine for the file
attachment logic, and just plug in Attache as a Shrine backend.

That way Attache can still do what it does best – serve files, but leave the
complexity of attaching logic to Shrine. So hopefully we'll come up with an
integration soon.

## In conclusion

Support for direct uploads, background processing and deleting, processing on
upload or on-the-fly, and ability to use with other ORMs is something that I
really expect from my file attachment library. However, none of the existing
libraries supported all of these requirements.

Therefore I decided to create a new library, [Shrine], building on top of the
knowledge from existing file upload libraries. The goal of Shrine is *not* to
be opinionated, to provide features and flexibility that allow you to satisfy
every use case in an optimal way.

That is a bold goal, but after 1 year of active development and research, I
feel quite confident that I achieved it. Or at least that the **possibilities
of what you can do** are greater than in any other file attachment Ruby
library. For the rest of this blog post series I will guide you through all of
the cool things that you can do with Shrine, so stay tuned!

[Shrine]: https://github.com/shrinerb/shrine
[Sequel]: https://github.com/jeremyevans/sequel
[Roda]: https://github.com/jeremyevans/roda
[evaluating libraries]: /evaluating-ruby-libraries/
[don't allow saving to disk]: https://devcenter.heroku.com/articles/dynos#ephemeral-filesystem
[30-second request timeout]: https://devcenter.heroku.com/articles/request-timeout
[asynchronous uploads]: /file-uploads-asynchronous-world/
[Sequel ≻ ActiveRecord]: /ode-to-sequel/
[ActiveRecord ⊁ Sequel]: /activerecord-is-reinventing-sequel/
[roda's routing]: /introduction-to-roda/
[aws-sdk]: https://github.com/aws/aws-sdk-ruby
[S3 object lifecycle]: http://docs.aws.amazon.com/AmazonS3/latest/UG/lifecycle-configuration-bucket-no-versioning.html
[Paperclip]: https://github.com/thoughtbot/paperclip
[delayed_paperclip]: https://github.com/jrgifford/delayed_paperclip
[Paperclip deleting]: https://github.com/thoughtbot/paperclip/issues/2281
[delayed_paperclip is now tied to ActiveJob]: https://github.com/jrgifford/delayed_paperclip/pull/178
[Paperclip spoofing]: https://github.com/thoughtbot/paperclip/issues?utf8=%E2%9C%93&q=label%3A%22Spoof%20related%20or%20Mime%20types%22%20
[CarrierWave]: https://github.com/carrierwaveuploader/carrierwave
[carrierwave-sequel]: https://github.com/carrierwaveuploader/carrierwave-sequel
[carrierwave_backgrounder]: https://github.com/lardawge/carrierwave_backgrounder/blob/38b381faaace6c75f7310ea726dcd1be2604d3fb/lib/backgrounder/orm/activemodel.rb
[carrierwave_direct]: https://github.com/dwilkie/carrierwave_direct/blob/a0bc3230e544c0ea88f35d2bb6b7eb6a1fdb9196/lib/carrierwave_direct/orm/activerecord.rb
[fog-aws]: https://github.com/fog/fog-aws
[carrierwave_backgrounder#169]: https://github.com/lardawge/carrierwave_backgrounder/pull/169
[carrierwave_backgrounder#186]: https://github.com/lardawge/carrierwave_backgrounder/pull/186
[carrierwave#1064]: https://github.com/carrierwaveuploader/carrierwave/issues/1064
[carrierwave#1349]: https://github.com/carrierwaveuploader/carrierwave/issues/1349
[carrierwave#1773]: https://github.com/carrierwaveuploader/carrierwave/issues/1773
[carrierwave#1756]: https://github.com/carrierwaveuploader/carrierwave/issues/1756
[carrierwave#1747]: https://github.com/carrierwaveuploader/carrierwave/issues/1747
[carrierwave#1734]: https://github.com/carrierwaveuploader/carrierwave/issues/1734
[carrierwave#1711]: https://github.com/carrierwaveuploader/carrierwave/issues/1711
[carrierwave#1680]: https://github.com/carrierwaveuploader/carrierwave/issues/1680
[carrierwave#1555]: https://github.com/carrierwaveuploader/carrierwave/issues/1555
[carrierwave#1543]: https://github.com/carrierwaveuploader/carrierwave/issues/1543
[carrierwave#1320]: https://github.com/carrierwaveuploader/carrierwave/issues/1320
[ImageTragick]: https://imagetragick.com/
[image bombs]: https://www.bamsoftware.com/hacks/deflate.html
[Refile]: https://github.com/refile/refile
[refile post]: https://www.varvet.com/blog/refile-fixing-ruby-file-uploads/
[refile javascript]: https://github.com/refile/refile/blob/master/app/assets/javascripts/refile.js
[Cloudinary]: http://cloudinary.com
[responsive image breakpoints]: http://cloudinary.com/blog/introducing_intelligent_responsive_image_breakpoints_solutions
[Dragonfly]: https://github.com/markevans/dragonfly
[dragonfly model]: https://github.com/markevans/dragonfly/blob/b8af810e647fc21e43ccc42b69beb6c9baa40abe/lib/dragonfly/model/attachment.rb
[dragonfly activerecord]: https://github.com/markevans/dragonfly/blob/b8af810e647fc21e43ccc42b69beb6c9baa40abe/lib/dragonfly/model/attachment.rb#L215
[refile-sequel]: https://github.com/refile/refile-sequel
[OWASP Content-Type]: https://www.owasp.org/index.php/Unrestricted_File_Upload#Using_.E2.80.9CContent-Type.E2.80.9D_from_the_Header
[Attache]: https://github.com/choonkeat/attache
[attache activerecord]: https://github.com/choonkeat/attache-rails/blob/4392af95b9ad8b4f56cf79ff0da2297802be9220/lib/attache/rails/model.rb
[attache backup]: https://github.com/choonkeat/attache#backup
