package com.parkingconcepts.mortimer

import android.app.Activity
import android.graphics.BitmapFactory
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
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "Cómic"
        try {
            val uri = intent.data ?: error("No se recibió el archivo.")
            archive = File(cacheDir, "comic_${System.currentTimeMillis()}.cbz").also { target ->
                contentResolver.openInputStream(uri)?.use { input ->
                    target.outputStream().use(input::copyTo)
                } ?: error("No se pudo leer el archivo.")
            }
            zip = ZipFile(archive!!)
            pages = zip!!.entries().asSequence()
                .filter { !it.isDirectory && it.name.substringAfterLast('.', "").lowercase() in IMAGE_EXTENSIONS }
                .map { it.name }
                .sortedWith(String.CASE_INSENSITIVE_ORDER)
                .toList()
            check(pages.isNotEmpty()) { "El CBZ no contiene páginas de imagen compatibles." }

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
            controls.addView(Button(this).apply { text = "← Anterior"; setOnClickListener { showPage(pageIndex - 1) } })
            controls.addView(Button(this).apply { text = "Siguiente →"; setOnClickListener { showPage(pageIndex + 1) } })
            root.addView(heading)
            root.addView(status)
            root.addView(image)
            root.addView(controls)
            setContentView(root)
            showPage(0)
        } catch (error: Exception) {
            Toast.makeText(this, error.message ?: "No se pudo abrir el cómic.", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    private fun showPage(index: Int) {
        if (pages.isEmpty()) return
        pageIndex = index.coerceIn(0, pages.lastIndex)
        val entry = zip?.getEntry(pages[pageIndex]) ?: return
        zip!!.getInputStream(entry).use { stream ->
            val bitmap = BitmapFactory.decodeStream(stream)
                ?: error("No se pudo decodificar la página.")
            image.setImageBitmap(bitmap)
        }
        status.text = "Página ${pageIndex + 1} de ${pages.size}"
    }

    override fun onDestroy() {
        zip?.close()
        archive?.delete()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_TITLE = "comic_title"
        private val IMAGE_EXTENSIONS = setOf("jpg", "jpeg", "png", "webp", "gif")
    }
}
