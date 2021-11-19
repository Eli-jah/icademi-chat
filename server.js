const express = require("express");
const app = express();
const path = require("path");
const http = require("http");
const server = http.createServer(app);
const socketServer = require("socket.io");
const io = socketServer(server);
const port = process.env.PORT || 9000;
const axios = require("axios");
const axiosInstance = axios.create({
  baseURL: "https://icademi.herokuapp.com/api/",
  timeout: 9000,
  headers: {
    Accept: "application/json",
  },
  // headers: {
  //   'Accept': 'application/json',
  //   'X-Requested-With': 'XMLHttpRequest',
  //   'Access-Control-Allow-Origin': '*',
  //   'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,DELETE,PUT,PATCH',
  //   'Access-Control-Allow-Credentials': 'true',
  //   'Access-Control-Allow-Headers': 'DNT,X-Mx-ReqToken,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Authorization',
  // }
});

let userinfo = {};
let contactList = [];

app.use("/images", express.static(path.join(__dirname, "images")));

app.get("/", (request, response) => {
  response.sendFile(__dirname + "/index.html");
});

// Socket.io connect
io.on("connection", (socket) => {
  // console.log(socket);
  // console.log(socket.id);
  console.log("Socket Connected.");

  // Login
  socket.on("login", (data, callback) => {
    userinfo = {};
    axiosInstance
      .post("passport/login", {
        email: data.email.trim(),
        password: data.password.trim(),
      })
      .then(function (response) {
        // console.log(response.data.data);
        userinfo = response.data.data;
        console.log(`User ${userinfo.name} login.`);
        updateContactList(socket, userinfo);
        // Emit login_success
        // socket.emit('login_success', userinfo);
        if (typeof callback === "function") {
          callback({
            status: 200,
            message: "Success",
            data: userinfo,
          });
        }
      })
      .catch(function (error) {
        console.log(error);
        if (typeof callback === "function") {
          callback({
            status: error.status,
            message: error.message,
          });
        }
      });
  });

  // Fetch contact list
  socket.on("fetch-contact-list", (userinfo) => {
    updateContactList(socket, userinfo);
  });

  // Recieve message
  socket.on("message", (data, callback) => {
    // console.log(data);
    if (data.sender.ws_token && data.recipient.id && data.message) {
      let message = data.message;
      let sender = data.sender;
      let recipient = data.recipient;
      axiosInstance
        .post("ws/chat", {
          ws_token: sender.ws_token,
          contact_id: recipient.id,
          content: message,
        })
        .then(function (response) {
          // console.log(response.data.data);
          console.log(
            `Message sent to ${recipient.name} by ${sender.name}: ${message}`
          );
          if (typeof callback === "function") {
            callback({
              status: 200,
              message: "Success",
            });
          }
          sendMessage(message, sender, recipient);
        })
        .catch(function (error) {
          console.log(error);
          if (typeof callback === "function") {
            callback({
              status: error.status,
              message: error.message,
            });
          }
        });
    }
  });

  // Fetch chat history
  socket.on("fetch-chat-history", (data) => {
    if (data.sender.ws_token && data.recipient.id) {
      let sender = data.sender;
      let recipient = data.recipient;

      axiosInstance
        .post("ws/chat_history", {
          ws_token: sender.ws_token,
          contact_id: recipient.id,
        })
        .then(function (response) {
          // console.log(response.data.data);
          let chatHistory = response.data.data;
          // console.log(chatHistory);
          // console.log(chatHistory.length);
          if (chatHistory.length > 0) {
            updateChatHistory(chatHistory, sender, recipient);
          }
        })
        .catch(function (error) {
          console.log(error);
        });
    }
  });

  // Logout
  socket.on("logout", (userinfo, callback) => {
    // console.log(userinfo.token);
    if (userinfo.token) {
      axiosInstance
        .post(
          "passport/logout",
          {},
          {
            headers: {
              Accept: "application/json",
              Authorization: "Bearer " + userinfo.token,
            },
          }
        )
        .then(function (response) {
          // console.log(response.data.data);
          console.log(`User ${userinfo.name} logout.`);
          if (typeof callback === "function") {
            callback({
              status: 200,
              message: "Success",
            });
          }
        })
        .catch(function (error) {
          console.log(error);
          if (typeof callback === "function") {
            callback({
              status: error.status,
              message: error.message,
            });
          }
        });
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log("Socket Disconnected.");
  });
});

// Fetch contact list
async function updateContactList(socket, userinfo) {
  contactList = [];
  if (userinfo.ws_token) {
    axiosInstance
      .post("ws/contacts", {
        ws_token: userinfo.ws_token,
      })
      .then(function (response) {
        // console.log(response.data.data);
        contactList = response.data.data;
        // set current client socket in the specific room
        socket.join(userinfo.type + "-" + userinfo.id);
        io.to(userinfo.type + "-" + userinfo.id).emit(
          "contact_list_updated",
          contactList
        );
        // io.emit(
        //   userinfo.type + "-" + userinfo.id + "-" + "contact_list_updated",
        //   contactList
        // );
        // subscribe current socket to some specific event channel rooms
        subscribeEventChannelRooms(socket, userinfo, contactList);
      })
      .catch(function (error) {
        console.log(error);
      });
  }
}

// Subscribe current socket to some specific event channel rooms
async function subscribeEventChannelRooms(socket, userinfo, contactList) {
  contactList.forEach((contact) => {
    if (userinfo.type == "teacher") {
      socket.join("teacher-" + userinfo.id + "-student-" + contact.id);
    } else {
      socket.join("teacher-" + contact.id + "-student-" + userinfo.id);
    }
  });
}

// Emit event message-sent
async function sendMessage(message, sender, recipient) {
  // console.log(sender);
  if (sender.type == "teacher") {
    io.to("teacher-" + sender.id + "-student-" + recipient.id).emit(
      "message-sent",
      {
        message: message,
        sender: {
          id: sender.id,
          name: sender.name,
        },
      }
    );
  } else {
    io.to("teacher-" + recipient.id + "-student-" + sender.id).emit(
      "message-sent",
      {
        message: message,
        sender: {
          id: sender.id,
          name: sender.name,
        },
      }
    );
  }
}

// Emit event chat-history-updated
async function updateChatHistory(chatHistory, sender, recipient) {
  // console.log(sender);
  if (sender.type == "teacher") {
    io.to("teacher-" + sender.id + "-student-" + recipient.id).emit(
      "chat-history-updated",
      chatHistory
    );
  } else {
    io.to("teacher-" + recipient.id + "-student-" + sender.id).emit(
      "chat-history-updated",
      chatHistory
    );
  }
}

server.listen(port, () =>
  console.log(`Server is running on port: ${port} ...`)
);
