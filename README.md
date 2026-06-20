# GFocus

GFocus là ứng dụng quản lý thời gian theo tư duy **block-based planning**. Thay vì chỉ tạo lịch theo giờ như calendar truyền thống, ứng dụng chia một ngày thành các **time blocks** cố định. Mặc định, mỗi block tương ứng với **30 phút**, vì vậy một ngày có **48 blocks**.

Mục tiêu chính của ứng dụng là giúp người dùng nhìn thấy rõ:

* Một ngày của mình đang bị chiếm bởi những đầu việc nào.
* Mỗi task đang tiêu tốn bao nhiêu block.
* Trong ngày/tuần còn bao nhiêu blank block để dự phòng.
* Lịch hiện tại có đang quá tải hay không.
* Session nào cần làm ngay, session nào có thể dời.
* Việc trì hoãn có đang làm vỡ kế hoạch hay không.
* Một ngày có đủ điều kiện để được tính streak hay không.

Ứng dụng không chỉ là todo app hoặc calendar app, mà là một hệ thống giúp user **quản lý năng lượng, độ kỷ luật và khả năng giữ cam kết với kế hoạch cá nhân**.

---

## 1. Core Idea

Mỗi ngày được chia thành các block nhỏ.

```text
1 block = 30 phút
1 ngày = 48 blocks
```

Ví dụ:

```text
Block 16 = 08:00 - 08:30
Block 17 = 08:30 - 09:00
Block 18 = 09:00 - 09:30
```

User không chỉ tạo task, mà sẽ đặt task vào các block cụ thể thông qua **session**.

Ví dụ:

```text
Task: Luyện đề TOEIC

Session:
08:00 - 09:30
=> chiếm 3 blocks
=> block 16, 17, 18
```

Trong hệ thống này:

```text
Task = đầu việc cần làm
Session = một lần thực hiện task trong lịch
Time Block = đơn vị thời gian nhỏ nhất
Blank Block = block chưa được gán session
```

Điểm quan trọng của app là **blank block không phải thời gian thừa**, mà là vùng đệm giúp user không bị vỡ lịch. Nếu một ngày không còn blank block, nghĩa là lịch đã quá kín và hệ thống phải can thiệp.

---

## 2. Main Concepts

### 2.1. Time Block

Time block là đơn vị thời gian nhỏ nhất trong app.

Mỗi block có:

* Ngày cụ thể.
* Thứ tự trong ngày.
* Thời gian bắt đầu.
* Thời gian kết thúc.
* Session đang chiếm block đó nếu có.

Một block được xem là blank nếu:

```text
time_blocks.session_id = null
```

Một block đã được plan nếu:

```text
time_blocks.session_id != null
```

Trong thiết kế hiện tại, một block chỉ được gắn với tối đa một session.

```text
1 time block -> 0 hoặc 1 session
1 session -> nhiều time blocks
```

Rule này giúp hệ thống dễ xử lý check-in, countdown, reorder, streak và thống kê.

---

### 2.2. Task

Task là đầu việc user muốn thực hiện.

Ví dụ:

```text
Luyện đề TOEIC
Làm báo cáo công ty
Học Data Engineering
Tập gym
Đọc sách
```

Task có thể thuộc một task type như:

```text
Study
Work
Health
Personal
Side Project
```

Một task có thể được thực hiện nhiều lần thông qua nhiều session.

Ví dụ:

```text
Task: Học Data Engineering

Session 1: Thứ 2, 20:00 - 21:00
Session 2: Thứ 4, 20:00 - 21:30
Session 3: Chủ nhật, 09:00 - 11:00
```

---

### 2.3. Session

Session là một lần user thực hiện task trong một khoảng block cụ thể.

Ví dụ:

```text
Session: Làm đề TOEIC Test 01
Task: Luyện đề TOEIC
Time: 08:00 - 09:30
Block count: 3
```

Session có hai loại:

```text
Immutable session
Mutable session
```

---

### 2.4. Immutable Session

Immutable session là những session cố định, không nên tự ý thay đổi hoặc tự động dời.

Ví dụ:

```text
Lịch học trên trường
Lịch làm việc công ty
Họp team
Lịch phỏng vấn
Sự kiện bắt buộc
```

Đặc điểm:

```text
session_type = immutable
```

Immutable session thường:

* Không được auto reorder.
* Không bị dời sang ngày khác.
* Nếu missed thì ghi nhận missed.
* Có thể tạo notification nghiêm khắc hơn.
* Có độ ưu tiên cao trong conflict detection.

---

### 2.5. Mutable Session

Mutable session là những session linh hoạt, do user tự plan và có thể dời.

Ví dụ:

```text
Học tiếng Anh
Tập gym
Đọc sách
Làm side project
Xem khóa học
Luyện đề
```

Đặc điểm:

```text
session_type = mutable
```

Mutable session có thể:

* Dời thủ công.
* Dời tự động khi user trễ check-in.
* Dời sang block khác trong ngày.
* Dời sang ngày tiếp theo nếu ngày hiện tại quá kín.
* Bị chọn làm session hy sinh nếu hệ thống cần tạo blank block hợp lệ.

---

## 3. Product Modules

Ứng dụng được chia thành bốn module lớn:

```text
1. User Module
2. Task Module
3. Streak Module
4. Notification Module
```

---

# 4. User Module

User Module quản lý thông tin người dùng và cấu hình cá nhân hóa.

Module này bao gồm:

```text
users
user_settings
```

---

## 4.1. User

User là chủ sở hữu toàn bộ dữ liệu trong hệ thống.

Mỗi user có:

* Tasks riêng.
* Task types riêng.
* Time blocks riêng.
* Sessions riêng.
* Notifications riêng.
* Streak riêng.
* Daily statistics riêng.
* Weekly statistics riêng.

Bảng chính:

```dbml
Table users {
  id uuid [pk]
  email varchar [unique, not null]
  username varchar [not null]
  created_at timestamp
  updated_at timestamp
}
```

---

## 4.2. User Configs

User configs lưu các thiết lập quan trọng ảnh hưởng tới cách app vận hành.

Bảng chính:

```dbml
Table user_settings {
  id uuid [pk]
  user_id uuid [not null, unique]
  block_duration_minutes int [not null, default: 30]
  strict_threshold_percent int [default: 80]
  blank_block_min_percent int [default: 20]
  enable_auto_reorder boolean [default: true]
  created_at timestamp
  updated_at timestamp
}
```

---

## 4.3. Các cấu hình quan trọng

### `block_duration_minutes`

Quy định độ dài của một block.

Mặc định:

```text
block_duration_minutes = 30
```

Tức là:

```text
1 ngày = 48 blocks
```

---

### `strict_threshold_percent`

Ngưỡng để xác định lịch tuần có quá tải hay không.

Ví dụ:

```text
strict_threshold_percent = 80
```

Nếu số block đã plan trong tuần vượt 80% tổng số block, hệ thống xem lịch đang quá tải và có thể kích hoạt strict mode.

---

### `blank_block_min_percent`

Tỉ lệ blank block tối thiểu nên còn lại.

Ví dụ:

```text
blank_block_min_percent = 20
```

Nếu blank block quá thấp, hệ thống cảnh báo user rằng lịch đang quá kín. Trong trường hợp một ngày không còn blank block nào, hệ thống có thể tự động move một mutable session có priority thấp sang ngày tiếp theo để tạo lại vùng đệm.

---

### `enable_auto_reorder`

Cho phép hệ thống tự động dời mutable session.

```text
true  => bật auto reorder
false => tắt auto reorder
```

---

# 5. Task Module

Task Module là module trung tâm của ứng dụng. Module này xử lý toàn bộ logic xoay quanh:

```text
time blocks
task types
tasks
sessions
check-in
in-a-task mode
auto reorder
strict mode
daily statistics
weekly statistics
```

Các bảng chính:

```text
task_types
tasks
time_blocks
sessions
session_reorder
daily_statistics
weekly_statistics
```

---

## 5.1. Task Types

Task type giúp user phân nhóm các đầu việc.

Ví dụ:

```text
Study
Work
Health
Personal
Side Project
Entertainment
```

Bảng chính:

```dbml
Table task_types {
  id uuid [pk]
  user_id uuid [not null]
  name varchar [not null]
  description text
  color varchar
  is_active boolean [default: true]
  created_at timestamp
  updated_at timestamp
}
```

Task type giúp dashboard hiển thị user đang dành thời gian cho nhóm nào nhiều nhất.

Ví dụ:

```text
Study: 32 blocks / tuần
Work: 80 blocks / tuần
Health: 10 blocks / tuần
Entertainment: 20 blocks / tuần
```

---

## 5.2. Tasks

Task là đầu việc cụ thể user muốn hoàn thành.

Bảng chính:

```dbml
Table tasks {
  id uuid [pk]
  user_id uuid [not null]
  title varchar [not null]
  description text
  task_type_id uuid
  priority task_priority [default: 'medium']
  status task_status
  created_at timestamp
  updated_at timestamp
}
```

Task có priority:

```text
low
medium
high
critical
```

Priority rất quan trọng trong auto reorder. Khi hệ thống cần tạo blank block hợp lệ, session thuộc task priority thấp hơn sẽ bị ưu tiên move trước.

Ví dụ:

```text
Task A: Họp công ty
Priority: critical

Task B: Luyện đề TOEIC
Priority: high

Task C: Xem khóa học phụ
Priority: medium

Task D: Đọc sách nhẹ
Priority: low
```

Nếu một ngày không còn blank block, hệ thống sẽ ưu tiên move session của Task D trước.

---

## 5.3. Time Blocks

Time blocks là nền tảng của toàn bộ app.

Bảng chính:

```dbml
Table time_blocks {
  id uuid [pk]
  user_id uuid [not null]
  block_date date [not null]
  block_index int [not null]
  start_time timestamp [not null]
  end_time timestamp [not null]
  session_id uuid
  created_at timestamp
  updated_at timestamp
}
```

Mỗi ngày, hệ thống tạo 48 blocks cho user.

Ví dụ:

```text
2026-06-20

Block 16: 08:00 - 08:30
Block 17: 08:30 - 09:00
Block 18: 09:00 - 09:30
```

Nếu user tạo session 08:00 - 09:30, session đó sẽ chiếm 3 blocks trên.

---

## 5.4. Sessions

Session là một lần thực hiện task trong lịch.

Bảng chính:

```dbml
Table sessions {
  id uuid [pk]
  user_id uuid [not null]
  task_id uuid [not null]
  title varchar [not null]
  description text
  session_type session_type [not null]
  planned_start_time timestamp [not null]
  planned_end_time timestamp [not null]
  actual_start_time timestamp
  actual_end_time timestamp
  block_count int [not null]
  checked_in bool
  created_at timestamp
  updated_at timestamp
}
```

Một session có:

* Task gốc.
* Loại session.
* Thời gian dự kiến.
* Thời gian thực tế.
* Số block chiếm.
* Trạng thái check-in.

Ví dụ:

```text
Task: Luyện đề TOEIC
Session: Làm đề TOEIC Test 01
Type: mutable
Time: 08:00 - 09:30
Block count: 3
```

---

## 5.5. Session Creation Flow

Khi user tạo session, hệ thống xử lý:

```text
1. Nhận planned_start_time và planned_end_time
2. Tính block_count
3. Xác định các block_index tương ứng
4. Kiểm tra các block đó có trống không
5. Nếu trống, tạo session
6. Gán session_id vào time_blocks
7. Cập nhật statistics
```

Ví dụ:

```text
User tạo session:
08:00 - 09:30

Hệ thống tính:
block_count = 3
block_index = 16, 17, 18
```

Nếu block 16, 17, 18 đang trống, session được tạo.

Nếu một trong các block đã có session, hệ thống báo conflict.

---

## 5.6. In-a-Task Mode

Khi đến giờ session, user cần check-in. Sau khi check-in, app chuyển vào **in-a-task mode**.

In-a-task mode là chế độ tập trung khi user đang thực hiện một session.

Màn hình này có thể bao gồm:

* Tên task.
* Tên session.
* Countdown timer.
* Thời gian còn lại.
* Nút complete.
* Nút cancel/skip nếu được phép.
* Mascot message.
* Fullscreen focus UI.
* Nhắc nhở không thoát task.

Ví dụ:

```text
Session: Luyện đề TOEIC
Time: 08:00 - 09:30
Countdown: 01:12:34
Mode: In a task
```

Khi user hoàn thành session:

```text
actual_end_time = current_time
```

Sau đó:

* Cập nhật completed blocks.
* Gửi notification hoàn thành.
* Có thể cộng điểm streak nếu ngày đó hợp lệ.
* Mascot có thể khen user.

---

## 5.7. Check-in Logic

Khi tới giờ session, app gửi notification yêu cầu check-in.

Nếu user check-in:

```text
checked_in = true
actual_start_time = current_time
```

Nếu user không check-in sau một khoảng thời gian:

* Gửi notification trễ.
* Nếu session immutable, chỉ cảnh báo.
* Nếu session mutable, có thể đưa vào auto reorder.

---

## 5.8. Auto Reorder

Auto Reorder là cơ chế tự động sắp xếp lại mutable session khi kế hoạch bị lệch.

Bảng chính:

```dbml
Table session_reorder {
  id uuid [pk]
  user_id uuid [not null]
  session_id uuid [not null]
  original_start_time timestamp [not null]
  original_end_time timestamp [not null]
  new_start_time timestamp
  new_end_time timestamp
  created_at timestamp
  updated_at timestamp
}
```

Auto reorder xảy ra trong các trường hợp:

```text
1. User trễ check-in
2. User bỏ lỡ mutable session
3. User tự reschedule
4. Hệ thống phát hiện conflict
5. Một ngày không còn blank block
```

---

## 5.9. Reorder khi user trễ check-in

Ví dụ:

```text
Session: Học tiếng Anh
Type: mutable
Time: 08:00 - 09:00
Block count: 2
```

Nếu user không check-in, hệ thống tìm một cụm 2 blank blocks khác.

Ví dụ tìm được:

```text
10:00 - 11:00
```

Hệ thống sẽ:

```text
1. Xóa session_id khỏi block cũ
2. Cập nhật planned_start_time và planned_end_time
3. Gán session_id vào block mới
4. Ghi log vào session_reorder
5. Gửi notification auto_reorder
```

---

## 5.10. Reorder khi một ngày không còn blank block

Đây là cơ chế quan trọng của ứng dụng.

Nếu một ngày không còn blank block, nghĩa là lịch của user đã quá kín. Khi đó user không còn vùng đệm để nghỉ, xử lý sự cố, hoặc hấp thụ các session bị trễ. Hệ thống phải cảnh báo và tự động tạo lại blank block hợp lệ.

Điều kiện:

```text
blank_blocks = 0
```

Khi điều kiện này xảy ra, hệ thống sẽ:

```text
1. Cảnh báo user rằng ngày hiện tại không còn blank block
2. Tìm các mutable session trong ngày
3. Loại bỏ immutable session khỏi danh sách có thể move
4. Chọn session có task priority thấp nhất
5. Move session đó sang ngày tiếp theo
6. Giải phóng các block cũ để tạo blank block
7. Ghi log vào session_reorder
8. Gửi notification auto_reorder
9. Đánh dấu ngày hiện tại không đủ điều kiện cộng streak
```

Ví dụ:

```text
Ngày 2026-06-20 có 48/48 blocks đã được plan.
blank_blocks = 0
```

Các session trong ngày:

```text
08:00 - 10:00 | Làm báo cáo công ty | immutable | critical
10:00 - 11:00 | Học Data Engineering | mutable | high
14:00 - 15:00 | Đọc sách nhẹ | mutable | low
20:00 - 21:00 | Tập gym | mutable | medium
```

Hệ thống chọn session priority thấp nhất:

```text
14:00 - 15:00 | Đọc sách nhẹ | mutable | low
```

Sau đó move sang ngày tiếp theo:

```text
Original:
2026-06-20 14:00 - 15:00

New:
2026-06-21 14:00 - 15:00 hoặc blank slot phù hợp gần nhất
```

Kết quả:

```text
Ngày 2026-06-20 có lại 2 blank blocks
Ngày 2026-06-20 bị đánh dấu không đủ điều kiện cộng streak
```

Lý do không cộng streak: user đã plan một ngày quá kín đến mức hệ thống phải can thiệp để tạo lại vùng đệm. Dù user có hoàn thành task, ngày đó vẫn không được xem là một ngày plan lành mạnh.

---

## 5.11. Strict Mode

Strict mode là chế độ cảnh báo khi lịch tuần quá tải.

Điều kiện:

```text
planned_blocks / total_blocks * 100 >= strict_threshold_percent
```

Ví dụ:

```text
total_week_blocks = 336
planned_blocks = 280
strict_threshold_percent = 80

280 / 336 = 83.33%
=> strict mode active
```

Khi strict mode active:

* Notification nghiêm khắc hơn.
* Mascot nhắc mạnh hơn.
* User bị cảnh báo về lịch quá tải.
* Auto reorder phải cẩn thận hơn.
* App ưu tiên giữ blank block để tránh vỡ lịch.

---

## 5.12. Daily Statistics

Daily statistics tổng hợp tình trạng block trong ngày.

Bảng chính:

```dbml
Table daily_statistics {
  id uuid [pk]
  user_id uuid [not null]
  stat_date date [not null]
  total_blocks int [not null]
  planned_blocks int [default: 0]
  blank_blocks int [default: 0]
  immutable_blocks int [default: 0]
  mutable_blocks int [default: 0]
  skipped_blocks int [default: 0]
  created_at timestamp
  updated_at timestamp
}
```

Ví dụ:

```text
Date: 2026-06-20

total_blocks = 48
planned_blocks = 46
blank_blocks = 2
immutable_blocks = 20
mutable_blocks = 26
skipped_blocks = 0
```

Daily statistics dùng cho:

* Today dashboard.
* Kiểm tra blank block.
* Đánh giá streak.
* Cảnh báo lịch quá tải trong ngày.
* Tính dữ liệu cho weekly statistics.

---

## 5.13. Weekly Statistics

Weekly statistics tổng hợp dữ liệu theo tuần.

Bảng chính:

```dbml
Table weekly_statistics {
  id uuid [pk]
  user_id uuid [not null]
  week_start_date date [not null]
  week_end_date date [not null]
  total_blocks int [not null]
  planned_blocks int [default: 0]
  blank_blocks int [default: 0]
  immutable_blocks int [default: 0]
  mutable_blocks int [default: 0]
  completed_blocks int [default: 0]
  missed_blocks int [default: 0]
  strict_mode_triggered_count int [default: 0]
  created_at timestamp
  updated_at timestamp
}
```

Weekly statistics dùng cho:

* Weekly dashboard.
* Tính strict mode.
* Theo dõi planned rate.
* Theo dõi blank rate.
* Xem tuần này user có quá tải hay không.

---

# 6. Streak Module

Streak Module dùng để đánh giá user có duy trì kế hoạch một cách lành mạnh hay không.

Streak không chỉ phản ánh việc user có hoàn thành task hay không, mà còn phản ánh user có giữ được một ngày plan hợp lý hay không.

Bảng chính:

```dbml
Table streaks {
  id uuid [pk]
  user_id uuid [not null, unique]
  current_streak int [default: 0]
  longest_streak int [default: 0]
  last_completed_date date
  last_missed_date date
  created_at timestamp
  updated_at timestamp
}
```

---

## 6.1. Tư duy streak

Một ngày được cộng streak không nên chỉ dựa trên việc user “có làm task”. Nếu user plan quá kín, không còn blank block, bị hệ thống phải move session sang ngày sau, thì đó không phải một ngày quản lý thời gian tốt.

Vì vậy streak được tính dựa trên cả hai yếu tố:

```text
1. User có hoàn thành session trong ngày
2. Ngày đó không bị hệ thống move session sang ngày tiếp theo để tạo blank block
```

---

## 6.2. Điều kiện được cộng streak

Một ngày được cộng streak nếu thỏa mãn:

```text
completed_blocks > 0
AND không có event "move session to next day" trong ngày đó
```

Có thể hiểu đơn giản:

```text
User có thực sự làm việc
AND lịch ngày đó không bị vỡ đến mức hệ thống phải can thiệp
```

Ví dụ được cộng streak:

```text
Ngày 2026-06-20:
completed_blocks = 6
blank_blocks cuối ngày = 4
không có session nào bị move sang ngày tiếp theo

=> được cộng streak
```

---

## 6.3. Điều kiện không được cộng streak

Một ngày không được cộng streak nếu xảy ra một trong các trường hợp:

```text
completed_blocks = 0
```

hoặc:

```text
có session bị move sang ngày tiếp theo vì ngày hiện tại không còn blank block
```

Ví dụ không được cộng streak:

```text
Ngày 2026-06-20:
completed_blocks = 8
nhưng blank_blocks = 0
hệ thống move session "Đọc sách nhẹ" sang 2026-06-21

=> không được cộng streak
```

Lý do:

```text
Dù user có hoàn thành task, lịch ngày đó vẫn bị xem là quá tải và thiếu buffer.
```

---

## 6.4. Điều kiện mất streak

User mất streak nếu qua hết ngày mà:

```text
completed_blocks = 0
```

hoặc ngày đó bị đánh dấu là không hợp lệ do:

```text
move session to next day
```

Khi mất streak:

```text
current_streak = 0
last_missed_date = today
```

Nếu ngày hợp lệ:

```text
current_streak += 1
longest_streak = max(longest_streak, current_streak)
last_completed_date = today
```

---

## 6.5. Ví dụ streak flow

### Ngày 1

```text
completed_blocks = 4
move_session_to_next_day = false

=> current_streak = 1
```

### Ngày 2

```text
completed_blocks = 6
move_session_to_next_day = false

=> current_streak = 2
```

### Ngày 3

```text
completed_blocks = 5
move_session_to_next_day = true

=> current_streak = 0
=> không cộng streak
```

### Ngày 4

```text
completed_blocks = 2
move_session_to_next_day = false

=> current_streak = 1
```

---

# 7. Notification Module

Notification Module chịu trách nhiệm nhắc user, cảnh báo user và phản hồi theo hành vi của user.

Bảng chính:

```dbml
Table notifications {
  id uuid [pk]
  user_id uuid [not null]
  session_id uuid
  type notification_type [not null]
  severity notification_severity [default: 'normal']
  title varchar [not null]
  message text [not null]
  scheduled_at timestamp
  sent_at timestamp
  read_at timestamp
  created_at timestamp
}
```

---

## 7.1. Notification Types

Các loại notification hiện có:

```text
session_start
checkin_late
session_completed
strict_mode
plan_reminder
auto_reorder
mascot_message
```

---

## 7.2. Notification Severity

Notification có ba mức độ:

```text
soft
normal
strict
```

### Soft

Dùng cho nhắc nhẹ.

Ví dụ:

```text
Bạn chưa plan cho ngày mai. Dành 5 phút sắp lịch nhé.
```

### Normal

Dùng cho thông báo thông thường.

Ví dụ:

```text
Đã tới giờ bắt đầu session "Học tiếng Anh".
```

### Strict

Dùng khi user đang trong strict mode, trễ check-in nhiều lần, hoặc lịch bị quá tải.

Ví dụ:

```text
Bạn đang không còn blank block nào trong ngày. Hệ thống sẽ dời một session priority thấp sang ngày mai để tạo vùng đệm.
```

---

## 7.3. Các case notification chính

### Case 1: Session sắp bắt đầu

```text
type = session_start
severity = normal
```

Ví dụ:

```text
Đã tới giờ bắt đầu "Luyện đề TOEIC".
```

---

### Case 2: User trễ check-in

```text
type = checkin_late
severity = normal hoặc strict
```

Ví dụ:

```text
Session đã bắt đầu nhưng bạn chưa check-in.
```

Nếu strict mode đang active:

```text
Bạn đang trong strict mode. Hãy check-in ngay để tránh vỡ kế hoạch.
```

---

### Case 3: Session hoàn thành

```text
type = session_completed
severity = normal
```

Ví dụ:

```text
Bạn đã hoàn thành 3 blocks cho "Luyện đề TOEIC".
```

---

### Case 4: Strict mode active

```text
type = strict_mode
severity = strict
```

Ví dụ:

```text
Tuần này bạn đã plan hơn 80% tổng số block. Lịch của bạn đang quá tải.
```

---

### Case 5: Nhắc user plan

```text
type = plan_reminder
severity = soft
```

Ví dụ:

```text
Ngày mai chưa có kế hoạch nào. Plan trước để tránh bị động nhé.
```

---

### Case 6: Auto reorder do trễ check-in

```text
type = auto_reorder
severity = normal
```

Ví dụ:

```text
Session "Học tiếng Anh" đã được dời từ 08:00 sang 10:00 vì bạn chưa check-in.
```

---

### Case 7: Auto move session sang ngày tiếp theo

```text
type = auto_reorder
severity = strict
```

Ví dụ:

```text
Hôm nay không còn blank block nào. Hệ thống đã dời session priority thấp nhất sang ngày mai để tạo lại vùng đệm.
```

Notification này rất quan trọng vì nó ảnh hưởng tới streak.

---

### Case 8: Mascot message

```text
type = mascot_message
severity = soft | normal | strict
```

Mascot xuất hiện trong các tình huống:

```text
1. Hoàn thành session
2. Bỏ lỡ session
3. Trễ check-in
4. Strict mode
5. Sắp mất streak
6. Không còn blank block
7. Session bị move sang ngày tiếp theo
```

Ví dụ khi hoàn thành:

```text
Tốt lắm! Bạn vừa hoàn thành thêm một session.
```

Ví dụ khi sắp mất streak:

```text
Bạn sắp mất streak rồi. Làm ít nhất một session nhỏ hôm nay nhé.
```

Ví dụ khi ngày quá kín:

```text
Lịch hôm nay không còn chỗ thở nữa. Mình đã giúp bạn dời một task nhẹ sang ngày mai.
```

---

# 8. Main User Flow

## 8.1. Plan một ngày

```text
1. User mở ngày cần plan
2. Hệ thống tạo 48 blocks nếu chưa có
3. User tạo task hoặc chọn task có sẵn
4. User tạo session cho task
5. Hệ thống gán session vào các block trống
6. Dashboard cập nhật planned blocks và blank blocks
```

---

## 8.2. Bắt đầu một session

```text
1. Đến giờ session
2. App gửi notification session_start
3. User check-in
4. App chuyển vào in-a-task mode
5. Countdown bắt đầu
```

---

## 8.3. Hoàn thành một session

```text
1. User bấm complete
2. Hệ thống cập nhật actual_end_time
3. Cập nhật completed blocks
4. Gửi notification session_completed
5. Mascot có thể gửi lời khen
6. Cuối ngày xét điều kiện streak
```

---

## 8.4. User trễ session

```text
1. Đến giờ session nhưng user không check-in
2. App gửi checkin_late notification
3. Nếu session immutable: chỉ cảnh báo
4. Nếu session mutable: tìm blank block mới
5. Nếu tìm được: reorder session
6. Gửi notification auto_reorder
```

---

## 8.5. Ngày không còn blank block

```text
1. Hệ thống phát hiện blank_blocks = 0
2. Gửi cảnh báo strict notification
3. Tìm mutable session có priority thấp nhất
4. Move session đó sang ngày tiếp theo
5. Giải phóng block trong ngày hiện tại
6. Ghi log reorder
7. Đánh dấu ngày đó không đủ điều kiện cộng streak
```
