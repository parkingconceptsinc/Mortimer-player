package com.parkingconcepts.mortimer

import android.app.Activity
import android.graphics.BitmapFactory
import android.graphics.drawable.BitmapDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import java.io.File
import java.util.zip.ZipFile

class ComicReaderActivity : Activity() {
    private var archive: File? = null
    private var zip: ZipFile? = null
    private var pages: List<String> = emptyList()
    private var pageIndex = 0
    private lateinit var image: ImageView
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "Comic"
        try {
            val uri = intent.data ?: error("No file was provided.")
            archive = File(cacheDir, "comic_${System.currentTimeMillis()}.cbz").also { target ->
                contentResolver.openInputStream(uri)?.use { input ->
                    target.outputStream().use(input::copyTo)
                } ?: error("Could not read the file.")
            }
            zip = ZipFile(archive!!)
            pages = zip!!.entries().asSequence()
                .filter { !it.isDirectory && it.name.substringAfterLast('.', "").lowercase() in IMAGE_EXTENSIONS }
                .map { it.name }
                .sortedWith(compareBy<String> { naturalSortKey(it) }.thenBy { it.lowercase() })
                .toList()
            check(pages.isNotEmpty()) { "This CBZ contains no supported image pages." }

            val root = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(16, 16, 16, 16)
                setBackgroundColor(android.graphics.Color.rgb(7, 7, 10))
            }
            val heading = TextView(this).apply {
                text = title
                textSize = 18f
                setTextColor(android.graphics.Color.WHITE)
                gravity = Gravity.CENTER
            }
            status = TextView(this).apply {
                textSize = 13f
                setTextColor(android.graphics.Color.LTGRAY)
                gravity = Gravity.CENTER
                setPadding(0, 8, 0, 8)
            }
            image = ImageView(this).apply {
                adjustViewBounds = true
                scaleType = ImageView.ScaleType.FIT_CENTER
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
            }
            val controls = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
            }
            controls.addView(Button(this).apply { text = "← Previous"; setOnClickListener { showPage(pageIndex - 1) } })
            controls.addView(Button(this).apply { text = "Next →"; setOnClickListener { showPage(pageIndex + 1) } })
            root.addView(heading)
            root.addView(status)
            root.addView(image)
            root.addView(controls)
            setContentView(root)
            showPage(0)
        } catch (error: Exception) {
            Toast.makeText(this, error.message ?: "Could not open the comic.", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    private fun showPage(index: Int) {
        if (pages.isEmpty()) return
        pageIndex = index.coerceIn(0, pages.lastIndex)
        val entry = zip?.getEntry(pages[pageIndex]) ?: return
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        zip!!.getInputStream(entry).use { BitmapFactory.decodeStream(it, null, bounds) }
        val targetWidth = resources.displayMetrics.widthPixels - 32
        val targetHeight = (resources.displayMetrics.heightPixels * 0.72f).toInt()
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= targetWidth ||
            bounds.outHeight / (sample * 2) >= targetHeight) sample *= 2
        val bitmap = zip!!.getInputStream(entry).use { stream ->
            BitmapFactory.decodeStream(stream, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: error("Could not decode the page.")
        val oldBitmap = (image.drawable as? BitmapDrawable)?.bitmap
        image.setImageBitmap(bitmap)
        if (oldBitmap != null && oldBitmap !== bitmap && !oldBitmap.isRecycled) oldBitmap.recycle()
        status.text = "Page ${pageIndex + 1} of ${pages.size}"
    }

    override fun onDestroy() {
        zip?.close()
        archive?.delete()
        super.onDestroy()
    }

    private fun naturalSortKey(path: String): String =
        Regex("""\d+""").replace(path.lowercase()) { match -> match.value.padStart(12, '0') }

    companion object {
        const val EXTRA_TITLE = "comic_title"
        private val IMAGE_EXTENSIONS = setOf("jpg", "jpeg", "png", "webp", "gif")
    }
}
