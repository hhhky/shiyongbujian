// ─────────────────────────────────────────────
// 课表解析钩子（注入到内嵌 WebView 的每个页面）
//
// 后续为某个学校编写解析脚本时，在页面里调用：
//   registerCourseParser(function (doc) {
//     return [{
//       name: '高等数学',
//       teacher: '张老师',
//       room: 'A101',
//       dayOfWeek: 1,          // 1=周一 … 7=周日，也接受「周一」
//       sections: '1-2',       // 节次，支持「1-2」「3,4」
//       weeks: '1-16'          // 周次，支持「1-16」「1-16单周」
//     }];
//   });
// 用户点击内嵌浏览器顶部的「解析」时，按注册顺序执行，
// 第一个返回非空数组的解析器生效，结果回传给 App。
// 页面内容只在本地解析，不会上传。
// ─────────────────────────────────────────────
(function () {
  if (window.CourseImportHooks) return;

  var parsers = [];

  window.CourseImportHooks = {
    parsers: parsers,
    register: function (fn) {
      if (typeof fn === 'function') parsers.push(fn);
    },
    run: function () {
      if (!parsers.length) return { ok: false, error: 'no_parser' };
      for (var i = 0; i < parsers.length; i++) {
        try {
          var list = parsers[i](document);
          if (list && list.length) return { ok: true, courses: list };
        } catch (e) {
          return { ok: false, error: String(e && e.message ? e.message : e) };
        }
      }
      return { ok: false, error: 'no_course' };
    }
  };

  // 便捷注册入口
  window.registerCourseParser = function (fn) {
    window.CourseImportHooks.register(fn);
  };
})();
