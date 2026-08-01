package com.ailearn.directorypicker;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "AILearnDirectoryPicker")
public class DirectoryPickerPlugin extends Plugin {

    @PluginMethod
    public void pickDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        startActivityForResult(call, intent, "pickDirectoryResult");
    }

    @ActivityCallback
    private void pickDirectoryResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("未选择目录");
            return;
        }
        Uri uri = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        } catch (Exception ignored) {
            // Some providers do not support persistable permissions; export still works for this session.
        }
        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        call.resolve(ret);
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String uriString = call.getString("uri");
        String filename = call.getString("filename");
        String data = call.getString("data");
        if (uriString == null || filename == null || data == null) {
            call.reject("参数不完整");
            return;
        }
        try {
            Uri treeUri = Uri.parse(uriString);
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(
                treeUri,
                DocumentsContract.getTreeDocumentId(treeUri)
            );
            Uri created = DocumentsContract.createDocument(
                getContext().getContentResolver(),
                parent,
                "application/zip",
                filename
            );
            if (created == null) {
                call.reject("无法创建备份文件");
                return;
            }
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            OutputStream output = getContext().getContentResolver().openOutputStream(created, "w");
            if (output == null) {
                call.reject("无法打开输出流");
                return;
            }
            output.write(bytes);
            output.close();
            call.resolve();
        } catch (Exception e) {
            call.reject("写入备份失败：" + e.getMessage());
        }
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        String uriString = call.getString("uri");
        if (uriString == null) {
            call.reject("目录为空");
            return;
        }
        try {
            Uri treeUri = Uri.parse(uriString);
            Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
                treeUri,
                DocumentsContract.getTreeDocumentId(treeUri)
            );
            Cursor cursor = getContext().getContentResolver().query(
                childrenUri,
                new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME
                },
                null,
                null,
                null
            );
            JSArray files = new JSArray();
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    String documentId = cursor.getString(0);
                    String name = cursor.getString(1);
                    Uri fileUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId);
                    JSObject item = new JSObject();
                    item.put("name", name);
                    item.put("uri", fileUri.toString());
                    files.put(item);
                }
                cursor.close();
            }
            JSObject ret = new JSObject();
            ret.put("files", files);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读取目录失败：" + e.getMessage());
        }
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String uriString = call.getString("uri");
        if (uriString == null) {
            call.reject("文件为空");
            return;
        }
        try {
            Uri uri = Uri.parse(uriString);
            InputStream input = getContext().getContentResolver().openInputStream(uri);
            if (input == null) {
                call.reject("无法打开备份文件");
                return;
            }
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int length;
            while ((length = input.read(chunk)) > 0) {
                buffer.write(chunk, 0, length);
            }
            input.close();
            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读取备份失败：" + e.getMessage());
        }
    }
}
